-- Add tsvector column for full-text search on message parts
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;--> statement-breakpoint

-- Create function to update search_vector from message parts
CREATE OR REPLACE FUNCTION update_message_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(
      (
        SELECT string_agg(value->>'text', ' ')
        FROM json_array_elements(NEW.parts::json) AS value
        WHERE value->>'type' = 'text'
      ),
      ''
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Create trigger to auto-update search_vector on INSERT/UPDATE
DROP TRIGGER IF EXISTS message_search_vector_update ON "Message";--> statement-breakpoint
CREATE TRIGGER message_search_vector_update
  BEFORE INSERT OR UPDATE OF parts
  ON "Message"
  FOR EACH ROW
  EXECUTE FUNCTION update_message_search_vector();--> statement-breakpoint

-- Create GIN index on search_vector for fast full-text search
CREATE INDEX IF NOT EXISTS "message_search_idx" ON "Message" USING GIN ("search_vector");--> statement-breakpoint

-- Create index on chatId for efficient filtering by chat
CREATE INDEX IF NOT EXISTS "message_chatId_idx" ON "Message" ("chatId");--> statement-breakpoint

-- Populate search_vector for existing messages
UPDATE "Message" SET parts = parts WHERE search_vector IS NULL;
