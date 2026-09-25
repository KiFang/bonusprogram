-- Фиксированный search_path для вспомогательных функций (рекомендация линтера Supabase).
alter function public._fail(text)                       set search_path = public;
alter function public._norm(text)                       set search_path = public;
alter function public._gen_code(text, int)              set search_path = public;
alter function public._is_reversed(uuid)                set search_path = public;
alter function public._spent(uuid, uuid)                set search_path = public;
alter function public._balance(uuid, uuid)              set search_path = public;
alter function public._tier_for(uuid, bigint)           set search_path = public;
alter function public._tier_json(uuid, uuid)            set search_path = public;
alter function public._artist_json(public.artists)      set search_path = public;
alter function public._default_tiers(uuid)              set search_path = public;
alter function public._entry_json(public.ledger_entries) set search_path = public;
