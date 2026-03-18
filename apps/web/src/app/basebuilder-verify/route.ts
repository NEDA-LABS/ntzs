const BASE_APP_ID = process.env.BASE_APP_ID

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function html(appId: string) {
  const safe = escapeHtml(appId)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="base:app_id" content="${safe}" />
    <title>BaseBuilder Verification</title>
  </head>
  <body>OK</body>
</html>`
}

export async function GET() {
  if (!BASE_APP_ID) {
    return new Response('BASE_APP_ID not set', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(html(BASE_APP_ID), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function HEAD() {
  return GET()
}
