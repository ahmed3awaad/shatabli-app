-- Shatabli — step 5: live updates for requests (non-destructive).
-- Realtime respects Row Level Security: each user only receives changes
-- to requests they are allowed to read.
alter publication supabase_realtime add table public.requests;
