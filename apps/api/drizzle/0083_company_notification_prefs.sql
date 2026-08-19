ALTER TABLE "companies" ADD COLUMN "email_notification_prefs" jsonb DEFAULT '{"workflow":true}'::jsonb NOT NULL;
