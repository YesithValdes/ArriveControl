import pg from 'pg'

// Una conexión LISTEN compartida por proceso. No consulta ni sondea tablas.
const global = globalThis
export async function escucharCambiosPanel(esquema, alCambiar, alFallar) {
 let estado = global.__arrivePanelEventos
 if (!estado) {
  const url = process.env.DATABASE_URL
  const local = /localhost|127\.0\.0\.1/.test(url ?? '')
  const client = new pg.Client({ connectionString:url, ssl:local?false:{rejectUnauthorized:false} })
  estado = { client, oyentes:new Set(), ready:null }
  global.__arrivePanelEventos = estado
  const actual = estado
  client.on('notification', aviso => {
   if(aviso.channel!=='arrive_panel_cambios') return
   let cambio
   try { cambio=JSON.parse(aviso.payload) } catch { return }
   for(const o of actual.oyentes) if(o.esquema===cambio.esquema) o.alCambiar(cambio.tablas)
  })
  client.on('error',()=>{
   if(global.__arrivePanelEventos===actual) delete global.__arrivePanelEventos
   for(const o of [...actual.oyentes]) o.alFallar()
   actual.oyentes.clear()
   void client.end().catch(()=>{})
  })
  estado.ready = client.connect().then(()=>client.query('LISTEN arrive_panel_cambios'))
 }
 const o = { esquema, alCambiar, alFallar }
 estado.oyentes.add(o)
 try { await estado.ready } catch(e) {
  estado.oyentes.delete(o)
  if(global.__arrivePanelEventos===estado) delete global.__arrivePanelEventos
  void estado.client.end().catch(()=>{})
  throw e
 }
 let cerrado=false
 return () => {
  if(cerrado) return
  cerrado=true
  estado.oyentes.delete(o)
  if(!estado.oyentes.size) {
   if(global.__arrivePanelEventos===estado) delete global.__arrivePanelEventos
   void estado.client.end().catch(()=>{})
  }
 }
}
