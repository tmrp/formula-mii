//! Allocation-free replay hot path. OpenF1 input uses 12 f32s/sample.
//! Output uses 16 f32s/driver: x,y,z,heading,speed,throttle,brake,gear,
//! rpm,drs,position,lap,visible,gap_seconds,finished,reserved.
use std::cell::RefCell;
const INPUT: usize = 12;
const OUTPUT: usize = 16;
const MAX_DRIVERS: usize = 20;

#[derive(Clone, Copy, Default)]
struct Driver { offset: usize, count: usize, end: f32, retired: bool }
struct Engine { samples: Vec<f32>, drivers: [Driver; MAX_DRIVERS], frame: [f32; MAX_DRIVERS * OUTPUT] }
impl Default for Engine {
    fn default() -> Self { Self { samples: Vec::new(), drivers: [Driver::default(); MAX_DRIVERS], frame: [0.; MAX_DRIVERS * OUTPUT] } }
}
thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::default()); }

impl Engine {
    fn row(&self, d: Driver, n: usize) -> &[f32] { let p = d.offset + n * INPUT; &self.samples[p..p + INPUT] }
    fn index(&self, d: Driver, t: f32) -> usize {
        let mut lo = 0; let mut hi = d.count;
        while lo < hi { let mid = (lo + hi) / 2; if self.row(d, mid)[0] <= t { lo = mid + 1; } else { hi = mid; } }
        lo.saturating_sub(1)
    }
    fn point(&self, d: Driver, t: f32) -> [f32; 3] {
        let i = self.index(d, t); let a = self.row(d, i); let b = self.row(d, (i + 1).min(d.count - 1));
        let gap = b[0] - a[0];
        // Never animate a fictional straight line across missing telemetry.
        let f = if gap > 0. && gap <= 3. { ((t - a[0]) / gap).clamp(0., 1.) } else { 0. };
        [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]
    }
    fn update(&mut self, t: f32) {
        for n in 0..MAX_DRIVERS {
            let d = self.drivers[n]; let o = n * OUTPUT;
            if d.count == 0 { self.frame[o..o+OUTPUT].fill(0.); continue; }
            let i = self.index(d, t); let a = self.row(d, i);
            let next = self.row(d, (i + 1).min(d.count - 1));
            let first = self.row(d, 0)[0]; let last = self.row(d, d.count - 1)[0];
            let gap = if t < first { first - t } else if t > last { t - last } else if next[0] - a[0] > 3. { t - a[0] } else { 0. };
            let sample_time = if d.retired { t.min(d.end) } else { t };
            let p = self.point(d, sample_time); let before = self.point(d, sample_time - 0.4); let after = self.point(d, if d.retired { (sample_time + 0.4).min(d.end) } else { sample_time + 0.4 });
            let dx = after[0] - before[0]; let dy = after[1] - before[1];
            let heading = if dx.abs() + dy.abs() > 0.02 { dx.atan2(dy) } else {
                let mut bearing = 0.;
                for distance in 1..=40 {
                    let prev = self.row(d, i.saturating_sub(distance));
                    let next = self.row(d, (i + distance).min(d.count - 1));
                    let bx = next[1] - prev[1]; let by = next[2] - prev[2];
                    if bx.abs() + by.abs() > 0.5 { bearing = bx.atan2(by); break; }
                }
                bearing
            };
            let metrics = [a[4],a[5],a[6],a[7],a[8],a[9],a[10],a[11]];
            let visible = t >= first - 5. && (!d.retired || t <= d.end + 8.) && gap < 10.;
            self.frame[o..o+OUTPUT].copy_from_slice(&[p[0],p[1],p[2],heading,metrics[0],metrics[1],metrics[2],metrics[3],metrics[4],metrics[5],metrics[6],metrics[7],if visible {1.} else {0.},gap,if t >= d.end {1.} else {0.},0.]);
        }
    }
}

#[no_mangle]
pub extern "C" fn allocate_samples(floats: usize) -> *mut f32 {
    ENGINE.with(|e| { let mut e=e.borrow_mut(); e.samples=vec![0.; floats]; e.samples.as_mut_ptr() })
}
#[no_mangle]
pub extern "C" fn configure_driver(index: usize, offset: usize, count: usize, end: f32, retired: u32) -> u32 {
    ENGINE.with(|e| { let mut e=e.borrow_mut();
        if index >= MAX_DRIVERS || count == 0 || offset.checked_add(count.saturating_mul(INPUT)).map_or(true, |x| x > e.samples.len()) || !end.is_finite() { return 0; }
        let rows = &e.samples[offset..offset+count*INPUT];
        if rows.chunks_exact(INPUT).any(|r| r.iter().any(|x| !x.is_finite())) || rows.chunks_exact(INPUT).zip(rows[INPUT..].chunks_exact(INPUT)).any(|(a,b)| b[0] < a[0]) { return 0; }
        e.drivers[index] = Driver {offset,count,end,retired: retired != 0}; 1
    })
}
#[no_mangle]
pub extern "C" fn render_frame(time: f32) -> *const f32 {
    ENGINE.with(|e| { let mut e=e.borrow_mut(); e.update(if time.is_finite() { time.max(0.) } else {0.}); e.frame.as_ptr() })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> Engine { let mut e=Engine::default(); for i in 0..4 { e.samples.extend([i as f32, i as f32 * 10., i as f32 * 20., 0., 200.,100.,0.,6.,11000.,12.,1.,2.]); } e.drivers[0]=Driver {offset:0,count:4,end:3.,retired:false}; e }
    #[test] fn interpolates_real_samples() { let mut e=engine(); e.update(1.5); assert_eq!(&e.frame[0..3], &[15.,30.,0.]); assert_eq!(e.frame[4],200.); assert_eq!(e.frame[12],1.); }
    #[test] fn seek_is_independent_of_previous_frame() { let mut e=engine(); e.update(2.8); e.update(0.4); assert!((e.frame[0]-4.).abs()<0.001); e.update(2.8); assert!((e.frame[0]-28.).abs()<0.001); }
    #[test] fn does_not_invent_motion_across_missing_data() { let mut e=engine(); e.samples[24]=20.; e.samples[36]=21.; e.drivers[0].end=21.; e.update(8.); assert_eq!(e.frame[0],10.); assert_eq!(e.frame[13],7.); }
    #[test] fn retired_car_disappears_and_seeking_restores_it() { let mut e=engine(); e.drivers[0].retired=true; e.update(15.); assert_eq!(e.frame[12],0.); e.update(1.); assert_eq!(e.frame[12],1.); }
    #[test] fn end_clamps_and_heading_is_finite() { let mut e=engine(); e.update(3.); assert_eq!(e.frame[0],30.); assert!(e.frame[3].is_finite()); assert_eq!(e.frame[14],1.); }
}
