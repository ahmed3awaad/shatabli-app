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
