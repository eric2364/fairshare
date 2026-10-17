import { useRegisterSW } from 'virtual:pwa-register/react';
export default function PwaUpdate(){
 const {needRefresh:[needRefresh,setNeedRefresh],updateServiceWorker}=useRegisterSW();
 if(!needRefresh)return null;
 return <aside role="status" style={{position:'fixed',bottom:90,left:16,right:16,maxWidth:460,margin:'auto',padding:16,background:'#183e35',color:'white',borderRadius:16,zIndex:100,boxShadow:'0 8px 40px #0003'}}><strong>A fresh version is ready.</strong><p style={{margin:'8px 0',fontSize:14}}>Finish saving your changes before updating.</p><button onClick={()=>void updateServiceWorker(true)} style={{padding:'8px 14px',marginRight:12,border:0,borderRadius:8,cursor:'pointer'}}>Update app</button><button onClick={()=>setNeedRefresh(false)} style={{background:'none',color:'white',border:0,cursor:'pointer'}}>Later</button></aside>;
}
