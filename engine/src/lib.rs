//! Allocation-free replay hot path. OpenF1 input uses 12 f32s/sample.
//! Output uses 16 f32s/driver: x,y,z,heading,speed,throttle,brake,gear,
//! rpm,drs,position,lap,visible,gap_seconds,finished,acceleration (m/s²).
use std::cell::RefCell;
const INPUT: usize = 12;
const OUTPUT: usize = 16;
const MAX_DRIVERS: usize = 20;
/// Seconds either side over which a car keeps to the recorded clock.
const WINDOW: f64 = 4.;

#[derive(Clone, Copy, Default)]
struct Driver {
    offset: usize,
    count: usize,
    end: f32,
    retired: bool,
}
struct Engine {
    samples: Vec<f32>,
    drivers: [Driver; MAX_DRIVERS],
    frame: [f32; MAX_DRIVERS * OUTPUT],
}
impl Default for Engine {
    fn default() -> Self {
        Self {
            samples: Vec::new(),
            drivers: [Driver::default(); MAX_DRIVERS],
            frame: [0.; MAX_DRIVERS * OUTPUT],
        }
    }
}
thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::default()); }

impl Engine {
    fn row(&self, d: Driver, n: usize) -> &[f32] {
        let p = d.offset + n * INPUT;
        &self.samples[p..p + INPUT]
    }
    fn index(&self, d: Driver, t: f64) -> usize {
        let mut lo = 0;
        let mut hi = d.count;
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.row(d, mid)[0] as f64 <= t {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo.saturating_sub(1)
    }
    /// Velocity through sample `i`, from its neighbours on either side,
    /// ignoring a neighbour across a gap in the telemetry.
    fn velocity(&self, d: Driver, i: usize) -> [f32; 3] {
        let at = self.row(d, i)[0];
        let prev = if i > 0 && at - self.row(d, i - 1)[0] <= 3. {
            i - 1
        } else {
            i
        };
        let next = if i + 1 < d.count && self.row(d, i + 1)[0] - at <= 3. {
            i + 1
        } else {
            i
        };
        let (a, b) = (self.row(d, prev), self.row(d, next));
        let dt = b[0] - a[0];
        if dt > 0. {
            [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt, (b[3] - a[3]) / dt]
        } else {
            [0.; 3]
        }
    }
    fn point(&self, d: Driver, t: f64) -> [f32; 3] {
        let i = self.index(d, t);
        let a = self.row(d, i);
        let b = self.row(d, (i + 1).min(d.count - 1));
        let gap = b[0] - a[0];
        // Never animate a fictional path across missing telemetry.
        if !(gap > 0. && gap <= 3.) {
            return [a[1], a[2], a[3]];
        }
        // A cubic through both locations whose velocity carries smoothly on
        // through each one (Catmull-Rom), so a car never jolts at a sample.
        let f = ((t - a[0] as f64) / gap as f64).clamp(0., 1.) as f32;
        let (f2, f3) = (f * f, f * f * f);
        let (va, vb) = (self.velocity(d, i), self.velocity(d, i + 1));
        let mut p = [0.; 3];
        for k in 0..3 {
            p[k] = (2. * f3 - 3. * f2 + 1.) * a[k + 1]
                + (f3 - 2. * f2 + f) * gap * va[k]
                + (3. * f2 - 2. * f3) * b[k + 1]
                + (f3 - f2) * gap * vb[k];
        }
        p
    }
    /// Cleans one driver's block of samples in place and returns how many
    /// remain. OpenF1 stamps locations with a clock that is often 0.1 s off,
    /// so plain interpolation makes a car surge and stall four times a
    /// second, and now and then a location is out of step, behind or beside
    /// where the car already was. Those locations are dropped, then each one
    /// left is re-timed so the car covers its recorded path at its recorded
    /// speed, keeping to the recorded clock on average over a few seconds.
    fn smooth(&mut self, offset: usize, count: usize) -> usize {
        let d = Driver {
            offset,
            count,
            end: 0.,
            retired: false,
        };
        let mut keep = Vec::with_capacity(count);
        keep.push(0);
        let (mut lo, mut hi) = (0, 0);
        for i in 1..count {
            let a = self.row(d, keep[keep.len() - 1]);
            let c = self.row(d, i);
            if a[4] > 30. && c[0] - a[0] <= 2. {
                // A car on the move goes forward, within 75° of the way it
                // was heading. That is taken from about a second either side,
                // so a single stray location cannot turn it round.
                while self.row(d, lo)[0] < a[0] - 1. {
                    lo += 1;
                }
                while hi < count - 1 && self.row(d, hi)[0] < a[0] + 1. {
                    hi += 1;
                }
                let (p, q) = (self.row(d, lo), self.row(d, hi));
                let (dx, dy) = (q[1] - p[1], q[2] - p[2]);
                if q[0] - p[0] <= 3.
                    && dx.hypot(dy) > 1.
                    && (c[1] - a[1]) * dx + (c[2] - a[2]) * dy
                        < 0.26 * (c[1] - a[1]).hypot(c[2] - a[2]) * dx.hypot(dy)
                {
                    continue;
                }
            }
            keep.push(i);
        }
        // How far ahead of the recorded clock each location was reached at
        // the recorded speed; standing or crawling cars keep the clock.
        let n = keep.len();
        let mut drift = vec![0f64; n];
        let mut clock = self.row(d, 0)[0] as f64;
        for k in 1..n {
            let (a, b) = (self.row(d, keep[k - 1]), self.row(d, keep[k]));
            let dt = (b[0] - a[0]) as f64;
            let speed = (a[4] + b[4]) as f64 / 7.2;
            let distance = (b[1] - a[1]).hypot(b[2] - a[2]).hypot(b[3] - a[3]) as f64;
            clock += if speed > 8. && dt <= 3. {
                distance / speed
            } else {
                dt
            };
            drift[k] = clock - b[0] as f64;
        }
        // Apply only the quick part of that drift: less its average over
        // WINDOW seconds either side, on the speed's clock so the correction
        // spreads evenly however far apart the locations were stamped.
        let mut sum = vec![0f64; n + 1];
        for k in 0..n {
            sum[k + 1] = sum[k] + drift[k];
        }
        let time = |k: usize| self.row(d, keep[k])[0] as f64 + drift[k];
        let (mut lo, mut hi) = (0, 0);
        let mut times = vec![0f64; n];
        for k in 0..n {
            while time(lo) < time(k) - WINDOW {
                lo += 1;
            }
            while hi < n && time(hi) <= time(k) + WINDOW {
                hi += 1;
            }
            times[k] = time(k) - (sum[hi] - sum[lo]) / (hi - lo) as f64;
            if k > 0 {
                times[k] = times[k].max(times[k - 1] + 0.01);
            }
        }
        for (k, &i) in keep.iter().enumerate() {
            let (from, to) = (offset + i * INPUT, offset + k * INPUT);
            self.samples.copy_within(from..from + INPUT, to);
            self.samples[to] = times[k] as f32;
        }
        n
    }
    /// Acceleration in m/s² from the recorded speed about half a second
    /// before sample `i`; zero across gaps in the telemetry.
    fn acceleration(&self, d: Driver, i: usize) -> f32 {
        let a = self.row(d, i);
        let mut j = i;
        while j > 0 && i - j < 8 && a[0] - self.row(d, j)[0] < 0.45 {
            j -= 1;
        }
        let b = self.row(d, j);
        let dt = a[0] - b[0];
        if dt >= 0.2 && dt <= 3. {
            (a[4] - b[4]) / 3.6 / dt
        } else {
            0.
        }
    }
    /// `time` is f64 so late in the race a car still moves evenly from one
    /// frame to the next; f32 would step in half-millisecond units.
    fn update(&mut self, time: f64) {
        let t = time as f32;
        for n in 0..MAX_DRIVERS {
            let d = self.drivers[n];
            let o = n * OUTPUT;
            if d.count == 0 {
                self.frame[o..o + OUTPUT].fill(0.);
                continue;
            }
            let i = self.index(d, time);
            let a = self.row(d, i);
            let next = self.row(d, (i + 1).min(d.count - 1));
            let first = self.row(d, 0)[0];
            let last = self.row(d, d.count - 1)[0];
            let gap = if t < first {
                first - t
            } else if t > last {
                t - last
            } else if next[0] - a[0] > 3. {
                t - a[0]
            } else {
                0.
            };
            let sample_time = if d.retired {
                time.min(d.end as f64)
            } else {
                time
            };
            let p = self.point(d, sample_time);
            let before = self.point(d, sample_time - 0.4);
            let after = self.point(
                d,
                if d.retired {
                    (sample_time + 0.4).min(d.end as f64)
                } else {
                    sample_time + 0.4
                },
            );
            let dx = after[0] - before[0];
            let dy = after[1] - before[1];
            let heading = if dx.abs() + dy.abs() > 0.02 {
                dx.atan2(dy)
            } else {
                let mut bearing = 0.;
                for distance in 1..=40 {
                    let prev = self.row(d, i.saturating_sub(distance));
                    let next = self.row(d, (i + distance).min(d.count - 1));
                    let bx = next[1] - prev[1];
                    let by = next[2] - prev[2];
                    if bx.abs() + by.abs() > 0.5 {
                        bearing = bx.atan2(by);
                        break;
                    }
                }
                bearing
            };
            let metrics = [a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11]];
            let acceleration = self.acceleration(d, i);
            let visible = t >= first - 5. && (!d.retired || t <= d.end + 8.) && gap < 10.;
            self.frame[o..o + OUTPUT].copy_from_slice(&[
                p[0],
                p[1],
                p[2],
                heading,
                metrics[0],
                metrics[1],
                metrics[2],
                metrics[3],
                metrics[4],
                metrics[5],
                metrics[6],
                metrics[7],
                if visible { 1. } else { 0. },
                gap,
                if t >= d.end { 1. } else { 0. },
                acceleration,
            ]);
        }
    }
}

#[no_mangle]
pub extern "C" fn allocate_samples(floats: usize) -> *mut f32 {
    ENGINE.with(|e| {
        let mut e = e.borrow_mut();
        e.samples = vec![0.; floats];
        e.samples.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn configure_driver(
    index: usize,
    offset: usize,
    count: usize,
    end: f32,
    retired: u32,
) -> u32 {
    ENGINE.with(|e| {
        let mut e = e.borrow_mut();
        if index >= MAX_DRIVERS
            || count == 0
            || offset
                .checked_add(count.saturating_mul(INPUT))
                .map_or(true, |x| x > e.samples.len())
            || !end.is_finite()
        {
            return 0;
        }
        let rows = &e.samples[offset..offset + count * INPUT];
        if rows
            .chunks_exact(INPUT)
            .any(|r| r.iter().any(|x| !x.is_finite()))
            || rows
                .chunks_exact(INPUT)
                .zip(rows[INPUT..].chunks_exact(INPUT))
                .any(|(a, b)| b[0] < a[0])
        {
            return 0;
        }
        let count = e.smooth(offset, count);
        e.drivers[index] = Driver {
            offset,
            count,
            end,
            retired: retired != 0,
        };
        1
    })
}
#[no_mangle]
pub extern "C" fn render_frame(time: f64) -> *const f32 {
    ENGINE.with(|e| {
        let mut e = e.borrow_mut();
        e.update(if time.is_finite() { time.max(0.) } else { 0. });
        e.frame.as_ptr()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> Engine {
        let mut e = Engine::default();
        for i in 0..4 {
            e.samples.extend([
                i as f32,
                i as f32 * 10.,
                i as f32 * 20.,
                0.,
                200.,
                100.,
                0.,
                6.,
                11000.,
                12.,
                1.,
                2.,
            ]);
        }
        e.drivers[0] = Driver {
            offset: 0,
            count: 4,
            end: 3.,
            retired: false,
        };
        e
    }
    fn sample(t: f32, x: f32) -> [f32; INPUT] {
        [t, x, 0., 0., 180., 100., 0., 7., 11000., 0., 1., 1.]
    }
    fn smoothed(rows: &[[f32; INPUT]]) -> Engine {
        let mut e = Engine::default();
        rows.iter().for_each(|r| e.samples.extend(r));
        let count = e.smooth(0, rows.len());
        e.drivers[0] = Driver {
            offset: 0,
            count,
            end: 1000.,
            retired: false,
        };
        e
    }
    #[test]
    fn evens_out_a_jittery_clock() {
        // 50 m/s down a straight, located every 0.25 s but stamped up to
        // 0.1 s off, as OpenF1 does.
        let jitter = [0., 0.1, -0.06, 0.04, -0.1, 0.07, -0.02, 0.09];
        let rows: Vec<_> = (0..200)
            .map(|k| sample(k as f32 * 0.25 + jitter[k % 8], k as f32 * 12.5))
            .collect();
        let mut e = smoothed(&rows);
        let mut last = 0.;
        for frame in 600..2400 {
            e.update(frame as f64 / 60.);
            let speed = (e.frame[0] - last) * 60.;
            assert!(frame == 600 || (speed - 50.).abs() < 2.5, "{speed} m/s");
            last = e.frame[0];
        }
    }
    #[test]
    fn ignores_locations_out_of_step() {
        let mut rows: Vec<_> = (0..40)
            .map(|k| sample(k as f32 * 0.25, k as f32 * 12.5))
            .collect();
        // One location 30 m behind the car, another 8 m off to its side.
        rows[20][1] -= 30.;
        rows[30][1] = rows[29][1] + 1.;
        rows[30][2] = 8.;
        let mut e = smoothed(&rows);
        assert_eq!(e.drivers[0].count, 38);
        let mut last = 0.;
        for frame in 0..600 {
            e.update(frame as f64 / 60.);
            assert!(e.frame[0] >= last, "the car never reverses");
            assert!(e.frame[1].abs() < 0.01, "or swerves");
            last = e.frame[0];
        }
    }
    #[test]
    fn interpolates_real_samples() {
        let mut e = engine();
        e.update(1.5);
        assert_eq!(&e.frame[0..3], &[15., 30., 0.]);
        assert_eq!(e.frame[4], 200.);
        assert_eq!(e.frame[12], 1.);
    }
    #[test]
    fn acceleration_from_recorded_speeds() {
        let mut e = engine();
        e.update(2.5);
        assert_eq!(e.frame[15], 0.);
        // 36 km/h faster over one second is 10 m/s².
        e.samples[2 * INPUT + 4] = 236.;
        e.update(2.5);
        assert!((e.frame[15] - 10.).abs() < 0.001);
    }
    #[test]
    fn seek_is_independent_of_previous_frame() {
        let mut e = engine();
        e.update(2.8);
        e.update(0.4);
        assert!((e.frame[0] - 4.).abs() < 0.001);
        e.update(2.8);
        assert!((e.frame[0] - 28.).abs() < 0.001);
    }
    #[test]
    fn does_not_invent_motion_across_missing_data() {
        let mut e = engine();
        e.samples[24] = 20.;
        e.samples[36] = 21.;
        e.drivers[0].end = 21.;
        e.update(8.);
        assert_eq!(e.frame[0], 10.);
        assert_eq!(e.frame[13], 7.);
    }
    #[test]
    fn retired_car_disappears_and_seeking_restores_it() {
        let mut e = engine();
        e.drivers[0].retired = true;
        e.update(15.);
        assert_eq!(e.frame[12], 0.);
        e.update(1.);
        assert_eq!(e.frame[12], 1.);
    }
    #[test]
    fn end_clamps_and_heading_is_finite() {
        let mut e = engine();
        e.update(3.);
        assert_eq!(e.frame[0], 30.);
        assert!(e.frame[3].is_finite());
        assert_eq!(e.frame[14], 1.);
    }
}
