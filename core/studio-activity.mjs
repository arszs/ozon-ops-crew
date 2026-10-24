import {randomUUID} from 'node:crypto';

export class StudioActivity{
 constructor(studio,{now=()=>Date.now(),intervalMs=10000}={}){this.studio=studio;this.now=now;this.intervalMs=intervalMs;this.timers=new Map();}
 async phase(id,phase){const at=new Date(this.now()).toISOString(),task=await this.studio.get(id),previous=task.activity,running=previous?.state==='running';const activity={token:running?previous.token:randomUUID(),state:'running',phase,startedAt:running?previous.startedAt:at,stepStartedAt:previous?.phase===phase&&running?previous.stepStartedAt:at,heartbeatAt:at};await this.studio.set(id,{activity});if(!this.timers.has(id)){const timer=setInterval(()=>this.pulse(id,activity.token).catch(()=>{}),this.intervalMs);timer.unref?.();this.timers.set(id,timer);}return activity;}
 async pulse(id,token){return this.studio.ws.repo.mutate(db=>{const task=db.studioTasks?.find(t=>t.id===id);if(task?.activity?.state==='running'&&task.activity.token===token)task.activity.heartbeatAt=new Date(this.now()).toISOString();});}
 async finish(id,state='finished'){clearInterval(this.timers.get(id));this.timers.delete(id);return this.studio.ws.repo.mutate(db=>{const task=db.studioTasks?.find(t=>t.id===id);if(task?.activity?.state==='running')task.activity={...task.activity,state,finishedAt:new Date(this.now()).toISOString(),heartbeatAt:new Date(this.now()).toISOString()};});}
 stop(){for(const timer of this.timers.values())clearInterval(timer);this.timers.clear();}
}
