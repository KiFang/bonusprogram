import { useState } from "react";
import { BOT_USERNAME } from "../nav";

export type TutorialRole = "member" | "artist";

const BOT = BOT_USERNAME || "artoki_bot";

type Slide = { mark: string; title: string; text: string; points?: string[] };

const SLIDES: Record<TutorialRole, Slide[]> = {
  member: [
    {
      mark: "АРТ",
      title: "Добро пожаловать в Артоки",
      text: "Бонусная программа художников. За каждый заказ вы получаете АРТы и потом оплачиваете ими часть следующих заказов.",
      points: ["1 АРТ = 1 ₽", "АРТы не сгорают, если художник не задал срок"],
    },
    {
      mark: "QR",
      title: "Как копить",
      text: "Покажите художнику свой код или QR — он внесёт сумму заказа, и АРТы придут автоматически.",
      points: ["Или художник пришлёт в чат кнопку «Забрать АРТы»", "Код всегда под рукой: кнопка вверху кошелька"],
    },
    {
      mark: "1·2·3",
      title: "Уровни у каждого художника",
      text: "Чем больше вы заказываете у художника, тем выше уровень: больше процент АРТов и большую часть заказа можно оплатить ими.",
      points: ["Уровень свой у каждого художника", "Пороги и проценты — в карточке художника"],
    },
    {
      mark: "∞",
      title: "Общий кошелёк группы",
      text: "Если художники работают группой, кошелёк общий: накопили у одного — можно потратить у другого.",
      points: ["Соло-художник ведёт личный кошелёк", "Выйти из программы можно в истории кошелька"],
    },
    {
      mark: "✦",
      title: "Заказы и коллекция",
      text: "Следите за этапами заказов, а готовые арты художник положит в вашу коллекцию.",
      points: ["В профиле: день рождения, «Приведи друга», сертификаты", "Уведомления приходят в бот"],
    },
  ],
  artist: [
    {
      mark: "АРТ",
      title: "Вы художник Артоки",
      text: "Клиенты копят у вас АРТы за заказы и оплачивают ими часть следующих. Правила — ваши уровни.",
      points: ["1 АРТ = 1 ₽", "Деньги клиенты платят вам напрямую"],
    },
    {
      mark: "₽",
      title: "Касса",
      text: "Отсканируйте QR клиента или введите его код, укажите сумму заказа и выберите: начислить АРТы или принять оплату АРТами.",
      points: ["Расчёт по уровню клиента — автоматически", "Ошибку можно отменить в «Операциях»"],
    },
    {
      mark: "@",
      title: "Прямо в чате",
      text: `В переписке с клиентом наберите @${BOT} 3000 и отправьте карточку — клиент нажмёт «Забрать АРТы».`,
      points: ["С Telegram Premium и бизнес-режимом: /addart 3000", "Кнопка действует 48 часов"],
    },
    {
      mark: "1·2·3",
      title: "Уровни",
      text: "В «Настройках» задайте пороги, процент начисления и какую часть заказа можно оплатить АРТами.",
      points: ["Можно ограничить приём АРТов коллег по группе", "Срок жизни АРТов — по желанию"],
    },
    {
      mark: "✦",
      title: "Заказы, слоты и коллекция",
      text: "Создавайте заказы, двигайте этапы — клиент получит уведомление. Прикладывайте арты: они попадут в его коллекцию.",
      points: ["Слоты: открыть запись, уйти в отдых или без лимита", "Ещё: акции, сертификаты, донаты"],
    },
    {
      mark: "!",
      title: "Одно правило",
      text: "Художник не может быть участником программы своей группы или своей соло-программы — начислять АРТы себе нельзя.",
      points: ["У других художников вы можете копить как обычный клиент"],
    },
  ],
};

export function Onboarding({ role, onDone }: { role: TutorialRole; onDone: () => void }) {
  const slides = SLIDES[role];
  const [i, setI] = useState(0);
  const s = slides[i];
  const last = i === slides.length - 1;

  function next() {
    if (last) onDone();
    else setI(i + 1);
  }

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={role === "artist" ? "Обучение художника" : "Как работает Артоки"}>
      <div className="onb-top">
        <span className="eyebrow">{role === "artist" ? "Обучение художника" : "Как это работает"}</span>
        {!last && <button className="linkbtn sm" onClick={onDone}>Пропустить</button>}
      </div>
      <div className="onb-body" key={i}>
        <div className="onb-mark" aria-hidden="true">{s.mark}</div>
        <div className="h2">{s.title}</div>
        <div className="soft" style={{ lineHeight: 1.55 }}>{s.text}</div>
        {s.points && (
          <ul className="onb-points">
            {s.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>
      <div className="onb-foot">
        <div className="onb-dots" aria-label={`Шаг ${i + 1} из ${slides.length}`}>
          {slides.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}
        </div>
        <div className="row2">
          {i > 0 ? <button className="btn" onClick={() => setI(i - 1)}>Назад</button> : <span />}
          <button className="btn btn-primary" onClick={next}>{last ? "Начать" : "Дальше"}</button>
        </div>
      </div>
    </div>
  );
}
