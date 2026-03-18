const BASE_APP_ID = process.env.BASE_APP_ID

export default function Head() {
  return BASE_APP_ID ? <meta name="base:app_id" content={BASE_APP_ID} /> : null
}
