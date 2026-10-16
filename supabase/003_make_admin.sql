-- Run AFTER you sign up in the app with this email. Makes that account the admin.
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'ahmedawaad76@icloud.com');
