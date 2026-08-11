'use client'

/**
 * Cliente de Better Auth para el navegador. Apunta a esta misma app; la
 * identidad vive en el esquema compartido `control`.
 */
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  // Sin baseURL, el cliente usa el MISMO origen desde el que se abrió la
  // página (localhost, IP local o túnel devtunnels, da igual). Un localhost
  // fijo rompía el login desde el celular: "localhost" allá es el celular.
  ...(process.env.NEXT_PUBLIC_APP_URL ? { baseURL: process.env.NEXT_PUBLIC_APP_URL } : {}),
})

export const { signIn, signOut, useSession } = authClient
