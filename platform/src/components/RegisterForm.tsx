"use client";

import { useActionState } from "react";
import { completeRegistration, type RegisterState } from "@/app/login/actions";
import { ru } from "@/lib/ru.ts";

export function RegisterForm({ email, today }: { email: string; today: string }) {
  const [state, action, pending] = useActionState(completeRegistration, {} as RegisterState);
  return (
    <form action={action} className="form">
      <p className="soft">Почта подтверждена: <b>{email}</b></p>
      <div className="field">
        <label htmlFor="nick">{ru.register.nick}</label>
        <input id="nick" name="nick" className="input" autoComplete="username" required minLength={3} maxLength={24}
          pattern="[A-Za-z0-9_]{3,24}" autoCapitalize="none" spellCheck={false} defaultValue={state.values?.nick} />
        <span className="hint">{ru.register.nickHint}</span>
      </div>
      <div className="field">
        <label htmlFor="display_name">{ru.register.name}</label>
        <input id="display_name" name="display_name" className="input" autoComplete="nickname" required maxLength={60} defaultValue={state.values?.display_name} />
      </div>
      <div className="field">
        <label htmlFor="birth_date">{ru.register.birth}</label>
        <input id="birth_date" name="birth_date" type="date" className="input" required min="1900-01-01" max={today} autoComplete="bday" defaultValue={state.values?.birth_date} />
        <span className="hint">{ru.register.birthHint}</span>
      </div>
      <label className="check">
        <input type="checkbox" name="consent" required defaultChecked={state.values?.consent} />
        <span>{ru.register.consent}</span>
      </label>
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>{ru.register.submit}</button>
    </form>
  );
}
