-- =====================================================================
-- Shatabli — step 4: security hardening. Safe to run on live data
-- (no tables are deleted). Paste into SQL Editor → Run.
-- =====================================================================

-- 1) Phone numbers: a customer sees the craftsman's contact details only
--    after the craftsman accepts (or for finished jobs). The craftsman sees
--    the customer who asked him. This stops people harvesting craftsmen's
--    phone numbers by sending fake requests.
drop policy if exists "profiles: read own or linked" on public.profiles;
create policy "profiles: read own or linked" on public.profiles for select to authenticated
  using (
    id = auth.uid() or public.is_admin()
    or exists (select 1 from public.requests r
               where r.customer_id = auth.uid() and r.craftsman_id = profiles.id
                 and r.status in ('accepted', 'done'))
    or exists (select 1 from public.requests r
               where r.craftsman_id = auth.uid() and r.customer_id = profiles.id)
  );

-- 2) Spam protection: at most 8 new requests per customer per hour,
--    and at most 3 open requests to the same craftsman.
create or replace function public.check_request_limits(p_customer uuid, p_craftsman uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.requests
      where customer_id = p_customer and created_at > now() - interval '1 hour') >= 8 then
    raise exception 'طلبات كتير في وقت قصير. استنى شوية وجرّب تاني.';
  end if;
  if p_craftsman is not null and (select count(*) from public.requests
      where customer_id = p_customer and craftsman_id = p_craftsman and status in ('pending', 'accepted')) >= 3 then
    raise exception 'عندك طلبات مفتوحة كتير مع الصنايعي ده.';
  end if;
end;
$$;
revoke execute on function public.check_request_limits(uuid, uuid) from public, anon, authenticated;

create or replace function public.requests_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_system() then
    return new;   -- trusted insert from book_quick_service() / book_helper()
  end if;
  if not exists (select 1 from public.craftsmen c
                 where c.id = new.craftsman_id and c.status = 'approved' and c.available) then
    raise exception 'الصنايعي ده مش متاح دلوقتي';
  end if;
  if new.craftsman_id = new.customer_id then
    raise exception 'مينفعش تطلب نفسك';
  end if;
  perform public.check_request_limits(new.customer_id, new.craftsman_id);
  new.status := 'pending';
  new.kind := 'craft';
  new.price := null;
  new.quick_service_id := null;
  new.helper_task := null; new.helpers_count := null; new.hours := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- Limits also apply to quick and helper bookings (checked before insert).
create or replace function public.limits_for_bookings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_system() then
    perform public.check_request_limits(new.customer_id, null);
  end if;
  return new;
end;
$$;
drop trigger if exists requests_booking_limits on public.requests;
create trigger requests_booking_limits before insert on public.requests
  for each row execute function public.limits_for_bookings();

-- 3) Photo links are not used yet: stop the app from writing arbitrary URLs.
revoke insert (photo_url) on public.craftsmen from authenticated;
revoke update (photo_url) on public.craftsmen from authenticated;

-- 4) Profiles: keep names and phones clean.
alter table public.profiles drop constraint if exists profiles_phone_format;
alter table public.profiles add constraint profiles_phone_format
  check (phone = '' or phone ~ '^\+?[0-9]{10,15}$') not valid;

-- 5) Reviews can't be edited or deleted by anyone but an admin (no grants
--    exist for that); make it explicit for the record.
revoke update, delete on public.reviews from anon, authenticated;
revoke delete on public.requests, public.craftsmen, public.profiles from anon, authenticated;
