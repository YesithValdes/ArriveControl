import { estadoAcceso, estadoAHttp } from '../../../lib/sesion'
import { escucharCambiosPanel } from '../../../lib/eventosPanel.js'
export const runtime='nodejs'
export const dynamic='force-dynamic'

export async function GET(req) {
 const ctx=await estadoAcceso('ver')
 if(ctx.estado!=='OK') return new Response(null,{status:estadoAHttp(ctx.estado)})
 const encoder=new TextEncoder()
 let cancelar=()=>{}
 const body=new ReadableStream({
  async start(controller) {
   let cerrado=false, desuscribir=null, latido=null
   cancelar=()=>{
    if(cerrado)return
    cerrado=true
    if(latido)clearInterval(latido)
    desuscribir?.()
    req.signal.removeEventListener('abort',cancelar)
    try{controller.close()}catch{}
   }
   req.signal.addEventListener('abort',cancelar,{once:true})
   if(req.signal.aborted){cancelar();return}
   const enviar=texto=>{if(!cerrado){try{controller.enqueue(encoder.encode(texto))}catch{cancelar()}}}
   try {
    desuscribir=await escucharCambiosPanel(ctx.esquema,tablas=>enviar('event: cambio\ndata: '+JSON.stringify({tablas})+'\n\n'),cancelar)
    if(cerrado){desuscribir();return}
    enviar(': conectado\n\n')
    // Comentarios de transporte para mantener la conexión: no refrescan datos.
    latido=setInterval(()=>enviar(': activo\n\n'),25000)
   } catch { cancelar() }
  },
  cancel(){cancelar()},
 })
 return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}})
}
