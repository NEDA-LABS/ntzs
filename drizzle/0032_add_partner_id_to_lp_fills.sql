ALTER TABLE "lp_fills" ADD COLUMN IF NOT EXISTS "partner_id" uuid REFERENCES "partners"("id") ON DELETE SET NULL;
