// Parked models keep their upstream worker; hand placements are built there too.
import {buildFins} from './fins.js';
import {buildDrawn} from './draw-build.js';
import {assignKeys,matchRemoved} from './ui/finkeys.js';
self.onmessage=({data})=>{
  const {id,topology,result,rot,opts,manual}=data;
  try{
    const built=buildFins(topology,result,rot,opts);
    if(manual?.requests.length){
      const records=assignKeys((built.fins??[]).map(f=>({...f})));
      const gone=opts.mode==='draw'?[]:[...matchRemoved(records,new Set(manual.removed??[])).keys()];
      built.manual=buildDrawn(topology,result,rot,manual.requests,
        {...manual.options,auto:opts.mode==='draw'?null:built,gone});
    }
    self.postMessage({id,built});
  }catch(e){self.postMessage({id,error:String(e?.stack??e)});}
};
