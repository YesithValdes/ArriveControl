/**
 * app/api/version/route.js
 * GET — identificador del DESPLIEGUE que está sirviendo. Público e inocuo.
 *
 * Existe para las tablets del kiosco: llevan días abiertas con la página en
 * memoria y no se enteran de los deploys. El kiosco consulta esto cada tanto
 * y, si el identificador cambió, se recarga solo cuando está en reposo.
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const version = process.env.VERCEL_DEPLOYMENT_ID
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? 'dev'
  return NextResponse.json(
    { ok: true, version },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
