"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { requestCode, verifyCode, type LoginState } from "@/app/login/actions";
import { ru } from "@/lib/ru.ts";

export function LoginFlow() {
  const [req, reqAction, reqPending] = useActionState(requestCode, { step: "email" } as LoginState);
  const [ver, verAction, verPending] = useActionState(verifyCode, { step: "code" } as LoginState);
  const [changeEmail, setChangeEmail] = useState(false);

  const onCode = req.step === "code" && !changeEmail && ver.step !== "email";
  const error = onCode ? ver.error : ver.step === "email" ? ver.error : req.error;

  if (onCode) {
    return (
      <form action={verAction} className="form" key="code">
        <p className="soft">{ru.login.codeLead(req.email ?? "")}</p>
        <input type="hidden" name="email" value={req.email} />
        <div className="field">
          <label htmlFor="code">{ru.login.code}</label>
          <input
            id="code" name="code" className="input code-input" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus
          />
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={verPending}>{ru.login.confirm}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setChangeEmail(true)}>{ru.login.otherEmail}</button>
      </form>
    );
  }

  return (
    <form action={reqAction} onSubmit={() => setChangeEmail(false)} className="form" key="email">
      <div className="field">
        <label htmlFor="email">{ru.login.email}</label>
        <input
          id="email" name="email" type="email" className="input" autoComplete="email" required autoFocus
          defaultValue={req.email} placeholder="name@example.ru"
        />
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={reqPending}>{ru.login.send}</button>
      <button type="button" className="btn btn-ghost" disabled aria-disabled="true">{ru.login.vk}</button>
      <p className="hint">
        Продолжая, вы соглашаетесь с <Link href="/terms">пользовательским соглашением</Link> и{" "}
        <Link href="/privacy">политикой обработки данных</Link>.
      </p>
    </form>
  );
}
