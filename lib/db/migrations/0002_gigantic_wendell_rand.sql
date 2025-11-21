ALTER TABLE "Chat" ADD COLUMN "ipfsCid" text;--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN "backedUpAt" timestamp;--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN "backupEncrypted" boolean DEFAULT false;