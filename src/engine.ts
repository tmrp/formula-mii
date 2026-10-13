import type {Metadata} from './types';
interface Exports extends WebAssembly.Exports {
 memory:WebAssembly.Memory;
 allocate_samples:(count:number)=>number;
 configure_driver:(i:number,offset:number,count:number,end:number,retired:number)=>number;
 render_frame:(time:number)=>number;
}
export class ReplayEngine {
 private constructor(private wasm:Exports, readonly driverCount:number) {}
 static async load(meta:Metadata, progress:(fraction:number)=>void):Promise<ReplayEngine> {
  const compressed=!!meta.compressed_sample_file&&'DecompressionStream' in window;
  const [wasmResponse,dataResponse]=await Promise.all([fetch('/wasm/replay_engine.wasm'),fetch(compressed?`/replay/${meta.compressed_sample_file}`:'/replay/samples.bin')]);
  if(!wasmResponse.ok||!dataResponse.ok) throw new Error('Replay assets could not be loaded. Please reload.');
  const reader=dataResponse.body?.getReader();const chunks:Uint8Array[]=[];let received=0;
  const total=Number(dataResponse.headers.get('content-length'))||(compressed?meta.compressed_byte_length!:meta.drivers.reduce((n,d)=>n+d.count*meta.stride*4,0));
  if(reader){while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;progress(Math.min(received/total,1));}}
  else {const a=new Uint8Array(await dataResponse.arrayBuffer());chunks.push(a);received=a.byteLength;}
  let bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  // Some hosts send Content-Encoding:gzip and the browser already inflates it.
  if(compressed&&bytes[0]===0x1f&&bytes[1]===0x8b){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));bytes=new Uint8Array(await new Response(stream).arrayBuffer());}
  if(bytes.length%4!==0||meta.stride!==12||meta.drivers.length>20)throw new Error('Unsupported replay format.');
  const {instance}=await WebAssembly.instantiate(await wasmResponse.arrayBuffer());const wasm=instance.exports as Exports;
  const ptr=wasm.allocate_samples(bytes.length/4);new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);
  meta.drivers.forEach((d,i)=>{if(!wasm.configure_driver(i,d.offset,d.count,d.active_until??d.end,d.retired?1:0))throw new Error(`Invalid telemetry for ${d.name_acronym}.`);});
  return new ReplayEngine(wasm,meta.drivers.length);
 }
 frame(time:number):Float32Array {return new Float32Array(this.wasm.memory.buffer,this.wasm.render_frame(time),this.driverCount*16);}
}
