# Ale Salinas

Sistema del consultorio dental construido con React, TypeScript, Vite y Firebase Realtime Database.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

## Variables de entorno

Crea un `.env.local` usando como base `.env.example`.

Variables requeridas:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Valores actuales de este proyecto:

- `VITE_FIREBASE_AUTH_DOMAIN=alesalinas-cf339.firebaseapp.com`
- `VITE_FIREBASE_DATABASE_URL=https://alesalinas-cf339-default-rtdb.firebaseio.com`
- `VITE_FIREBASE_PROJECT_ID=alesalinas-cf339`

## Build

```bash
pnpm build
```

## Deploy en Netlify

1. Conecta este repositorio de GitHub en Netlify.
2. Branch de produccion recomendada: `main`.
3. Netlify leera `netlify.toml`.
4. Carga en Netlify las mismas variables de entorno listadas arriba.
5. Cada `push` a `main` disparara un deploy automatico.
