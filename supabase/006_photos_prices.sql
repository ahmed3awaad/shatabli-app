-- =====================================================================
-- Shatabli — step 6: craftsman photos + admin price editing.
-- Non-destructive. Paste into SQL Editor → Run.
-- =====================================================================

-- ---------- 1) Craftsman photos (Supabase Storage) ----------
-- Public-read bucket, max 2 MB, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Each user can only write inside their own folder: avatars/<their id>/...
drop policy if exists "avatars: upload own" on storage.objects;
drop policy if exists "avatars: update own" on storage.objects;
drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- The card stores only the file path, and only through this function,
-- which checks the path belongs to the caller and has a safe name.
create or replace function public.set_my_photo(p_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'سجّل دخول الأول'; end if;
  if p_path is not null and p_path !~ ('^' || auth.uid()::text || '/[a-z0-9]{8,40}\.(jpg|png|webp)$') then
    raise exception 'مسار الصورة غير صحيح';
  end if;
  perform set_config('shatabli.system', '1', true);
  update public.craftsmen set photo_url = p_path where id = auth.uid();
  perform set_config('shatabli.system', '', true);
end;
$$;
revoke execute on function public.set_my_photo(text) from public, anon;
grant execute on function public.set_my_photo(text) to authenticated;

-- ---------- 2) Admin edits prices and turns services on/off ----------
create policy "quick services: admin updates" on public.quick_services for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "helper tasks: admin updates" on public.helper_tasks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant update (price, active) on public.quick_services to authenticated;
grant update (rate, active) on public.helper_tasks to authenticated;
alter table public.quick_services drop constraint if exists quick_price_range;
alter table public.quick_services add constraint quick_price_range check (price between 10 and 100000);
alter table public.helper_tasks drop constraint if exists task_rate_range;
alter table public.helper_tasks add constraint task_rate_range check (rate between 10 and 10000);
