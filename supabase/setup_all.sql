-- =====================================================================
-- Shatabli — FULL SETUP (reset + schema + helper). Safe to run on a
-- fresh project or to redo setup BEFORE any real users exist:
-- it deletes Shatabli's tables and recreates them.
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.reviews, public.requests, public.helper_tasks, public.quick_services,
  public.craftsmen, public.categories, public.profiles cascade;
drop function if exists public.is_admin(), public.is_system(), public.handle_new_user(),
  public.requests_before_insert(), public.requests_before_update(),
  public.book_quick_service(int, text, text, text), public.book_helper(text, int, int, text, text, text),
  public.reviews_before_insert(), public.reviews_after_insert(),
  public.admin_set_craftsman_status(uuid, text), public.craftsmen_before_update(), public.craftsmen_before_insert() cascade;

-- =====================================================================
-- Shatabli (شطبلي) — database setup, Phase 1
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe model: every table has Row Level Security, and the app only gets
-- the exact columns it is allowed to write (column-level grants).
-- =====================================================================

-- ---------- helpers ---------------------------------------------------

-- Internal flag: set only inside our own server functions (never by the app)
-- so trusted updates (ratings, job counts, quick bookings) pass the guards.
create or replace function public.is_system()
returns boolean
language sql stable set search_path = ''
as $$ select coalesce(current_setting('shatabli.system', true), '') = '1'; $$;

-- ---------- profiles (one row per signed-up person) -------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'customer' check (role in ('customer', 'craftsman', 'admin')),
  full_name   text not null default '' check (char_length(full_name) <= 80),
  phone       text not null default '' check (char_length(phone) <= 20),
  area        text not null default '' check (char_length(area) <= 60),
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;


-- Create the profile automatically on sign-up. Role comes from sign-up
-- metadata but can only be customer or craftsman (admins are set by hand).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  wanted text := coalesce(new.raw_user_meta_data ->> 'role', 'customer');
begin
  insert into public.profiles (id, role, full_name, phone, area)
  values (
    new.id,
    case when wanted = 'craftsman' then 'craftsman' else 'customer' end,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 20),
    left(coalesce(new.raw_user_meta_data ->> 'area', ''), 60)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- categories (fixed list) -----------------------------------

create table public.categories (
  id     text primary key,
  name   text not null,
  sort   int  not null default 0
);
alter table public.categories enable row level security;

insert into public.categories (id, name, sort) values
  ('paint', 'نقاش', 1), ('elec', 'كهربائي', 2), ('plumb', 'سبّاك', 3), ('carp', 'نجّار', 4),
  ('tile', 'سيراميك', 5), ('gyps', 'جبس بورد', 6), ('plast', 'محارة', 7), ('alu', 'ألوميتال', 8);

-- ---------- craftsmen (public card of a craftsman) --------------------

create table public.craftsmen (
  id            uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  category      text not null references public.categories (id),
  area          text not null default '' check (char_length(area) <= 60),
  price         int  not null check (price > 0 and price < 1000000),
  unit          text not null default 'م²' check (char_length(unit) <= 20),
  years         int  not null default 0 check (years between 0 and 70),
  about         text not null default '' check (char_length(about) <= 600),
  photo_url     text check (photo_url is null or char_length(photo_url) <= 500),
  available     boolean not null default true,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  rating_avg    numeric(2,1) not null default 0,
  rating_count  int not null default 0,
  jobs_done     int not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.craftsmen enable row level security;
create index craftsmen_category_idx on public.craftsmen (category) where status = 'approved';

-- ---------- quick services (fixed price, set by Shatabli) -------------

create table public.quick_services (
  id        serial primary key,
  category  text not null references public.categories (id),
  name      text not null,
  price     int  not null check (price > 0),
  duration  text not null default '',
  active    boolean not null default true,
  sort      int not null default 0
);
alter table public.quick_services enable row level security;

insert into public.quick_services (category, name, price, duration, sort) values
  ('plumb', 'تصليح حنفية أو خلاط', 250, 'ساعة', 1),
  ('plumb', 'تسليك حوض أو بالوعة', 300, 'ساعة', 2),
  ('elec',  'تركيب نجفة أو أباليك', 250, 'ساعة', 3),
  ('elec',  'تغيير مفتاح أو بريزة', 120, 'نص ساعة', 4),
  ('paint', 'دهان أوضة لحد ١٢ م²', 3500, 'يومين', 5),
  ('carp',  'تغيير كالون باب', 300, 'ساعة', 6),
  ('plumb', 'تغيير سيفون أو قاعدة', 450, 'ساعتين', 7),
  ('plumb', 'تركيب سخان', 600, 'ساعتين', 8),
  ('elec',  'كشف وتصليح عطل كهربا', 350, 'ساعتين', 9),
  ('elec',  'تركيب شاشة على الحيطة', 400, 'ساعة', 10),
  ('carp',  'ضبط باب أو دولاب', 250, 'ساعة', 11),
  ('tile',  'تغيير بلاطة سيراميك مكسورة', 250, 'ساعتين', 12);

-- ---------- requests (a customer asks a craftsman) --------------------

create table public.requests (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  craftsman_id      uuid not null references public.craftsmen (id) on delete cascade,
  quick_service_id  int references public.quick_services (id),
  description       text not null check (char_length(description) between 3 and 1000),
  address           text not null check (char_length(address) between 3 and 300),
  day               text not null default '' check (char_length(day) <= 60),
  time_slot         text not null default '' check (char_length(time_slot) <= 60),
  price             int,
  status            text not null default 'pending'
                    check (status in ('pending', 'accepted', 'rejected', 'done', 'cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.requests enable row level security;
create index requests_customer_idx  on public.requests (customer_id, created_at desc);
create index requests_craftsman_idx on public.requests (craftsman_id, created_at desc);

-- New request: forced to pending, craftsman must be approved and available,
-- and you can't book yourself.
create or replace function public.requests_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_system() then
    return new;   -- trusted insert from book_quick_service()
  end if;
  if not exists (select 1 from public.craftsmen c
                 where c.id = new.craftsman_id and c.status = 'approved' and c.available) then
    raise exception 'هذا الصنايعي غير متاح الآن';
  end if;
  if new.craftsman_id = new.customer_id then
    raise exception 'لا يمكنك طلب نفسك';
  end if;
  new.status := 'pending';
  new.price := null;
  new.quick_service_id := null;   -- quick services go through book_quick_service()
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
create trigger requests_before_insert before insert on public.requests
  for each row execute function public.requests_before_insert();

-- Status changes: only the allowed moves, only by the right person.
create or replace function public.requests_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if public.is_admin() or me is null then   -- admin, or server-side maintenance
    new.updated_at := now();
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if old.status = 'pending' and new.status in ('accepted', 'rejected') and me = old.craftsman_id then
    null;
  elsif old.status = 'accepted' and new.status = 'done' and me = old.craftsman_id then
    null;
  elsif old.status in ('pending', 'accepted') and new.status = 'cancelled' and me = old.customer_id then
    null;
  else
    raise exception 'تغيير الحالة غير مسموح';
  end if;
  if new.status = 'done' then
    perform set_config('shatabli.system', '1', true);
    update public.craftsmen set jobs_done = jobs_done + 1 where id = old.craftsman_id;
    perform set_config('shatabli.system', '', true);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger requests_before_update before update on public.requests
  for each row execute function public.requests_before_update();

-- Book a quick service: Shatabli picks the best available craftsman in
-- that category and the price is the fixed one, not anything the app sends.
create or replace function public.book_quick_service(
  p_service_id int, p_address text, p_day text, p_note text default ''
)
returns public.requests
language plpgsql security definer set search_path = ''
as $$
declare
  svc public.quick_services;
  pick uuid;
  r public.requests;
begin
  if auth.uid() is null then raise exception 'سجّل دخول الأول'; end if;
  select * into svc from public.quick_services where id = p_service_id and active;
  if not found then raise exception 'الخدمة غير موجودة'; end if;
  if char_length(coalesce(p_address, '')) < 3 then raise exception 'اكتب العنوان'; end if;

  select c.id into pick from public.craftsmen c
   where c.category = svc.category and c.status = 'approved' and c.available and c.id <> auth.uid()
   order by c.rating_avg desc, c.rating_count desc, c.jobs_done desc
   limit 1;
  if pick is null then raise exception 'مفيش صنايعي متاح للخدمة دي دلوقتي'; end if;

  -- Trusted insert: fixed price and auto-assigned craftsman.
  perform set_config('shatabli.system', '1', true);
  insert into public.requests (customer_id, craftsman_id, quick_service_id, description, address, day, time_slot, price, status)
  values (auth.uid(), pick, svc.id,
          left(svc.name || case when coalesce(p_note, '') <> '' then ' — ' || p_note else '' end, 1000),
          left(p_address, 300), left(coalesce(p_day, ''), 60), 'سعر ثابت', svc.price, 'accepted')
  returning * into r;
  perform set_config('shatabli.system', '', true);
  return r;
end;
$$;

-- ---------- reviews ---------------------------------------------------

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null unique references public.requests (id) on delete cascade,
  customer_id   uuid not null references public.profiles (id) on delete cascade,
  craftsman_id  uuid not null references public.craftsmen (id) on delete cascade,
  customer_name text not null default '',
  stars         int  not null check (stars between 1 and 5),
  comment       text not null default '' check (char_length(comment) <= 500),
  created_at    timestamptz not null default now()
);
alter table public.reviews enable row level security;
create index reviews_craftsman_idx on public.reviews (craftsman_id, created_at desc);

-- Only the customer of a finished job can review it, once.
create or replace function public.reviews_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  rq public.requests;
  nm text;
begin
  select * into rq from public.requests where id = new.request_id;
  if not found or rq.customer_id <> auth.uid() or rq.status <> 'done' then
    raise exception 'تقدر تقيّم بس الشغل اللي خلص';
  end if;
  select full_name into nm from public.profiles where id = auth.uid();
  new.customer_id := rq.customer_id;
  new.craftsman_id := rq.craftsman_id;
  -- Show only the first name and initial, e.g. "مها ر."
  new.customer_name := coalesce(split_part(nm, ' ', 1) || coalesce(' ' || left(nullif(split_part(nm, ' ', 2), ''), 1) || '.', ''), '');
  new.created_at := now();
  return new;
end;
$$;
create trigger reviews_before_insert before insert on public.reviews
  for each row execute function public.reviews_before_insert();

create or replace function public.reviews_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('shatabli.system', '1', true);
  update public.craftsmen c set
    rating_count = s.cnt,
    rating_avg = round(s.avg_stars, 1)
  from (select count(*) cnt, avg(stars) avg_stars from public.reviews where craftsman_id = new.craftsman_id) s
  where c.id = new.craftsman_id;
  perform set_config('shatabli.system', '', true);
  return new;
end;
$$;
create trigger reviews_after_insert after insert on public.reviews
  for each row execute function public.reviews_after_insert();

-- ---------- admin actions ---------------------------------------------

create or replace function public.admin_set_craftsman_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'للأدمن بس'; end if;
  if p_status not in ('pending', 'approved', 'suspended') then raise exception 'حالة غير صحيحة'; end if;
  perform set_config('shatabli.system', '1', true);
  update public.craftsmen set status = p_status where id = p_id;
  perform set_config('shatabli.system', '', true);
end;
$$;

-- Stop a craftsman from editing protected columns (status, ratings).
create or replace function public.craftsmen_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() and not public.is_system() and auth.uid() is not null then
    new.status := old.status;
    new.rating_avg := old.rating_avg;
    new.rating_count := old.rating_count;
    new.jobs_done := old.jobs_done;
  end if;
  return new;
end;
$$;
create trigger craftsmen_before_update before update on public.craftsmen
  for each row execute function public.craftsmen_before_update();

-- New craftsman cards always start as pending (waiting for your approval).
create or replace function public.craftsmen_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    new.id := auth.uid();
    new.status := 'pending';
    new.rating_avg := 0; new.rating_count := 0; new.jobs_done := 0;
    update public.profiles set role = 'craftsman' where id = auth.uid() and role = 'customer';
  end if;
  return new;
end;
$$;
create trigger craftsmen_before_insert before insert on public.craftsmen
  for each row execute function public.craftsmen_before_insert();

-- ---------- row level security policies -------------------------------

-- profiles: you see yourself; the other side of a request sees your name
-- and phone; admins see everyone.
create policy "profiles: read own or linked" on public.profiles for select to authenticated
  using (
    id = auth.uid() or public.is_admin()
    or exists (select 1 from public.requests r
               where (r.customer_id = auth.uid() and r.craftsman_id = profiles.id)
                  or (r.craftsman_id = auth.uid() and r.customer_id = profiles.id))
  );
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "categories: anyone reads" on public.categories for select to anon, authenticated using (true);

create policy "craftsmen: read approved, own, or admin" on public.craftsmen for select to anon, authenticated
  using (status = 'approved' or id = auth.uid() or public.is_admin());
create policy "craftsmen: create own card" on public.craftsmen for insert to authenticated
  with check (id = auth.uid() or public.is_admin());
create policy "craftsmen: update own card" on public.craftsmen for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy "quick services: anyone reads active" on public.quick_services for select to anon, authenticated
  using (active or public.is_admin());

create policy "requests: parties read" on public.requests for select to authenticated
  using (customer_id = auth.uid() or craftsman_id = auth.uid() or public.is_admin());
create policy "requests: customer creates" on public.requests for insert to authenticated
  with check (customer_id = auth.uid());
create policy "requests: parties update" on public.requests for update to authenticated
  using (customer_id = auth.uid() or craftsman_id = auth.uid() or public.is_admin())
  with check (customer_id = auth.uid() or craftsman_id = auth.uid() or public.is_admin());

create policy "reviews: anyone reads" on public.reviews for select to anon, authenticated using (true);
create policy "reviews: customer writes" on public.reviews for insert to authenticated
  with check (customer_id = auth.uid());

-- ---------- what the app is allowed to touch (column grants) ----------

grant usage on schema public to anon, authenticated;

grant select on public.categories, public.quick_services, public.reviews to anon, authenticated;
grant select on public.craftsmen to anon, authenticated;
grant select on public.profiles, public.requests to authenticated;

grant update (full_name, phone, area) on public.profiles to authenticated;
grant insert (name, category, area, price, unit, years, about, photo_url, available) on public.craftsmen to authenticated;
grant update (name, category, area, price, unit, years, about, photo_url, available) on public.craftsmen to authenticated;
grant insert (craftsman_id, description, address, day, time_slot) on public.requests to authenticated;
grant update (status) on public.requests to authenticated;
grant insert (request_id, stars, comment) on public.reviews to authenticated;

revoke execute on function public.book_quick_service(int, text, text, text) from public, anon;
grant  execute on function public.book_quick_service(int, text, text, text) to authenticated;
revoke execute on function public.admin_set_craftsman_status(uuid, text) from public, anon;
grant  execute on function public.admin_set_craftsman_status(uuid, text) to authenticated;
grant  execute on function public.is_admin() to anon, authenticated;

-- =====================================================================
-- Shatabli — step 2: Helper (مساعد بالساعة) + request types + icons
-- Paste into Supabase → SQL Editor → Run (after schema.sql).
-- =====================================================================

-- Helpers sign up like craftsmen, under their own category.
insert into public.categories (id, name, sort) values ('helper', 'مساعد', 9)
on conflict (id) do nothing;

-- Helper tasks with an hourly rate per helper (set by Shatabli).
create table public.helper_tasks (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  rate         int  not null check (rate > 0),
  def_helpers  int  not null default 1 check (def_helpers between 1 and 6),
  def_hours    int  not null default 2 check (def_hours between 2 and 12),
  icon         text not null default 'hand',
  tint         text not null default 'blue',
  active       boolean not null default true,
  sort         int  not null default 0
);
alter table public.helper_tasks enable row level security;
create policy "helper tasks: anyone reads active" on public.helper_tasks for select to anon, authenticated
  using (active or public.is_admin());
grant select on public.helper_tasks to anon, authenticated;

insert into public.helper_tasks (id, name, description, rate, def_helpers, def_hours, icon, tint, sort) values
  ('move',     'نقل عفش',           'شيل ونقل العفش جوه الشقة أو لشقة تانية، مع التغليف', 150, 3, 4, 'sofa',    'orange', 1),
  ('decor',    'تعليق ديكورات',     'براويز، ستاير، رفوف، مرايات، وإضاءة ديكور',          150, 1, 2, 'frame',   'rose',   2),
  ('event',    'تنظيم مناسبة',      'تجهيز حفلة أو عزومة: ترتيب المكان، والزينة، والاستقبال', 180, 2, 5, 'party', 'violet', 3),
  ('assemble', 'تركيب أثاث',        'تركيب دواليب وسراير ومكاتب جاهزة',                    170, 1, 3, 'tool',    'teal',   4),
  ('clean',    'تنظيف بعد التشطيب', 'شيل بقايا الدهان والأسمنت، وتنظيف الأرضيات والشبابيك', 130, 2, 6, 'sparkle', 'sky',    5),
  ('debris',   'شيل مخلفات',        'تنزيل الردم ومخلفات التشطيب من الشقة',                150, 2, 3, 'trash',   'slate',  6),
  ('errand',   'مشاوير وشراء',      'شراء حاجات، أو استلام وتوصيل في نفس اليوم',            120, 1, 2, 'bag',     'green',  7),
  ('other',    'حاجة تانية',        'قول لنا محتاج إيه، وهنبعتلك المساعد المناسب',          140, 1, 2, 'dots',    'blue',   8);

-- Icons for quick services (used by the app).
alter table public.quick_services add column icon text not null default 'tool';
update public.quick_services set icon = case name
  when 'تصليح حنفية أو خلاط' then 'drop'
  when 'تسليك حوض أو بالوعة' then 'faucet'
  when 'تركيب نجفة أو أباليك' then 'lamp'
  when 'تغيير مفتاح أو بريزة' then 'plug'
  when 'دهان أوضة لحد ١٢ م²' then 'bucket'
  when 'تغيير كالون باب' then 'key'
  when 'تغيير سيفون أو قاعدة' then 'toilet'
  when 'تركيب سخان' then 'heater'
  when 'كشف وتصليح عطل كهربا' then 'zapoff'
  when 'تركيب شاشة على الحيطة' then 'tv'
  when 'ضبط باب أو دولاب' then 'door'
  when 'تغيير بلاطة سيراميك مكسورة' then 'tile1'
  else 'tool' end;

-- Request type, and helper details.
alter table public.requests
  add column kind          text not null default 'craft' check (kind in ('craft', 'quick', 'helper')),
  add column helper_task   text references public.helper_tasks (id),
  add column helpers_count int check (helpers_count between 1 and 6),
  add column hours         int check (hours between 2 and 12);

-- Quick bookings are marked as such.
create or replace function public.book_quick_service(
  p_service_id int, p_address text, p_day text, p_note text default ''
)
returns public.requests
language plpgsql security definer set search_path = ''
as $$
declare
  svc public.quick_services;
  pick uuid;
  r public.requests;
begin
  if auth.uid() is null then raise exception 'سجّل دخول الأول'; end if;
  select * into svc from public.quick_services where id = p_service_id and active;
  if not found then raise exception 'الخدمة غير موجودة'; end if;
  if char_length(coalesce(p_address, '')) < 3 then raise exception 'اكتب العنوان'; end if;

  select c.id into pick from public.craftsmen c
   where c.category = svc.category and c.status = 'approved' and c.available and c.id <> auth.uid()
   order by c.rating_avg desc, c.rating_count desc, c.jobs_done desc
   limit 1;
  if pick is null then raise exception 'مفيش صنايعي متاح للخدمة دي دلوقتي'; end if;

  perform set_config('shatabli.system', '1', true);
  insert into public.requests (customer_id, craftsman_id, quick_service_id, kind, description, address, day, time_slot, price, status)
  values (auth.uid(), pick, svc.id, 'quick',
          left(svc.name || case when coalesce(p_note, '') <> '' then ' — ' || p_note else '' end, 1000),
          left(p_address, 300), left(coalesce(p_day, ''), 60), 'سعر ثابت', svc.price, 'accepted')
  returning * into r;
  perform set_config('shatabli.system', '', true);
  return r;
end;
$$;

-- Book a helper: Shatabli picks the best available helper (team lead),
-- price = rate × helpers × hours, computed here, never sent by the app.
create or replace function public.book_helper(
  p_task text, p_helpers int, p_hours int, p_address text, p_day text, p_note text default ''
)
returns public.requests
language plpgsql security definer set search_path = ''
as $$
declare
  t public.helper_tasks;
  pick uuid;
  r public.requests;
begin
  if auth.uid() is null then raise exception 'سجّل دخول الأول'; end if;
  select * into t from public.helper_tasks where id = p_task and active;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  if p_helpers not between 1 and 6 or p_hours not between 2 and 12 then raise exception 'عدد المساعدين أو الساعات غير صحيح'; end if;
  if char_length(coalesce(p_address, '')) < 3 then raise exception 'اكتب العنوان'; end if;

  select c.id into pick from public.craftsmen c
   where c.category = 'helper' and c.status = 'approved' and c.available and c.id <> auth.uid()
   order by c.rating_avg desc, c.rating_count desc, c.jobs_done desc
   limit 1;
  if pick is null then raise exception 'مفيش مساعد متاح دلوقتي'; end if;

  perform set_config('shatabli.system', '1', true);
  insert into public.requests (customer_id, craftsman_id, kind, helper_task, helpers_count, hours, description, address, day, time_slot, price, status)
  values (auth.uid(), pick, 'helper', t.id, p_helpers, p_hours,
          left(t.name || ': ' || p_helpers || ' مساعد × ' || p_hours || ' ساعات'
               || case when coalesce(p_note, '') <> '' then ' — ' || p_note else '' end, 1000),
          left(p_address, 300), left(coalesce(p_day, ''), 60), 'مساعد بالساعة', t.rate * p_helpers * p_hours, 'accepted')
  returning * into r;
  perform set_config('shatabli.system', '', true);
  return r;
end;
$$;

revoke execute on function public.book_helper(text, int, int, text, text, text) from public, anon;
grant  execute on function public.book_helper(text, int, int, text, text, text) to authenticated;
