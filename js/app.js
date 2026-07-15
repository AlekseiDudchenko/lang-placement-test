/* Логика интерфейса: экраны старта, теста и результата. */
(function () {
  "use strict";

  const SKILL_LABELS = { gram: "Грамматика", vok: "Лексика", les: "Чтение" };

  const LEVEL_INFO = {
    A0: {
      title: "Начинающий",
      desc: "Вы делаете первые шаги в немецком. Рекомендуем начать с базового курса уровня A1: алфавит, приветствия, простейшие фразы.",
    },
    A1: {
      title: "Уровень выживания",
      desc: "Вы понимаете и используете простые повседневные фразы: представиться, спросить дорогу, сделать заказ. Следующая цель — уверенное прошедшее время и повседневная лексика (A2).",
    },
    A2: {
      title: "Предпороговый уровень",
      desc: "Вы справляетесь с типовыми бытовыми ситуациями и простыми текстами. Следующая цель — придаточные предложения, пассив и связная речь (B1).",
    },
    B1: {
      title: "Пороговый уровень",
      desc: "Вы понимаете суть чётких сообщений на знакомые темы и можете объясниться в большинстве ситуаций. Следующая цель — сложные конструкции, Konjunktiv и абстрактные темы (B2).",
    },
    B2: {
      title: "Продвинутый уровень",
      desc: "Вы понимаете сложные тексты и говорите достаточно бегло, чтобы общаться с носителями без напряжения. Следующая цель — стилистические нюансы, идиоматика и научно-публицистические тексты (C1).",
    },
    C1: {
      title: "Профессиональное владение",
      desc: "Вы свободно пользуетесь языком в учёбе, работе и социальной жизни, понимаете скрытый смысл объёмных текстов. Следующая цель — отточенная стилистика и полная идиоматичность (C2).",
    },
    C2: {
      title: "Владение в совершенстве",
      desc: "Вы понимаете практически всё услышанное и прочитанное и выражаетесь спонтанно, точно и стилистически уместно. Это высший уровень по шкале CEFR — поздравляем!",
    },
  };

  let engine = null;
  let currentQuestion = null;
  let locked = false;

  const $ = (id) => document.getElementById(id);

  function show(screenId) {
    for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
    $(screenId).classList.add("active");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─────────────────────────── Тест ───────────────────────────

  function startTest() {
    engine = new AdaptiveEngine(QUESTIONS);
    show("screen-quiz");
    renderNextQuestion();
  }

  function renderNextQuestion() {
    currentQuestion = engine.nextQuestion();
    if (!currentQuestion) { finishTest(); return; }
    locked = false;

    const n = engine.answers.length + 1;
    const { minQuestions, maxQuestions } = engine.cfg;
    $("q-counter").textContent = `Вопрос ${n}`;
    $("q-range").textContent = `всего ${minQuestions}–${maxQuestions}`;
    $("q-level").textContent = currentQuestion.level;
    $("q-level").dataset.level = currentQuestion.level;
    $("progress-fill").style.width = `${engine.progress() * 100}%`;

    const passageEl = $("q-passage");
    if (currentQuestion.text) {
      passageEl.textContent = currentQuestion.text;
      passageEl.hidden = false;
    } else {
      passageEl.hidden = true;
    }
    $("q-text").textContent = currentQuestion.q;

    // Правильный вариант в банке всегда первый (индекс 0) — перемешиваем
    // индексы и помечаем правильную кнопку через dataset, а не сравнением текста.
    const order = shuffle(currentQuestion.opts.map((_, i) => i));
    const list = $("q-options");
    list.innerHTML = "";
    order.forEach((optIdx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.textContent = currentQuestion.opts[optIdx];
      if (optIdx === 0) btn.dataset.correct = "1";
      btn.addEventListener("click", () => answer(optIdx === 0, btn));
      list.appendChild(btn);
    });

    $("card-quiz").classList.remove("fade-in");
    void $("card-quiz").offsetWidth; // перезапуск CSS-анимации
    $("card-quiz").classList.add("fade-in");
  }

  function answer(correct, clickedBtn) {
    if (locked) return;
    locked = true;

    for (const btn of document.querySelectorAll("#q-options .option")) {
      btn.disabled = true;
      if (btn.dataset.correct) btn.classList.add("is-correct");
    }
    if (clickedBtn && !correct) clickedBtn.classList.add("is-wrong");

    engine.recordAnswer(currentQuestion, correct);

    setTimeout(() => {
      if (engine.isFinished()) finishTest();
      else renderNextQuestion();
    }, clickedBtn ? 900 : 350);
  }

  // ─────────────────────────── Результат ───────────────────────────

  function finishTest() {
    const r = engine.result();
    const info = LEVEL_INFO[r.level];

    $("result-level").textContent = r.level;
    $("result-level").dataset.level = r.level;
    $("result-title").textContent = info.title;
    $("result-desc").textContent = info.desc;

    $("stat-questions").textContent = r.total;
    $("stat-correct").textContent = `${r.correctCount} из ${r.total}`;
    $("stat-confidence").textContent = `${Math.round(r.confidence * 100)}%`;

    renderScale(r);
    renderSkills(r);
    renderTrajectory(r);

    show("screen-result");
  }

  function renderScale(r) {
    // θ от -3.6 до 3.6 отображаем на шкалу 0–100%.
    const pos = Math.max(0, Math.min(1, (r.theta + 3.6) / 7.2)) * 100;
    $("scale-marker").style.left = `${pos}%`;
    const seW = Math.min(40, (r.se / 7.2) * 2 * 100);
    const seEl = $("scale-se");
    seEl.style.left = `${pos}%`;
    seEl.style.width = `${seW}%`;
  }

  function renderSkills(r) {
    const wrap = $("skills");
    wrap.innerHTML = "";
    for (const key of ["gram", "vok", "les"]) {
      const s = r.skills[key];
      if (!s) continue;
      const pct = Math.round((s.correct / s.total) * 100);
      const row = document.createElement("div");
      row.className = "skill-row";

      const head = document.createElement("div");
      head.className = "skill-head";
      const name = document.createElement("span");
      name.textContent = SKILL_LABELS[key];
      const val = document.createElement("span");
      val.className = "skill-val";
      val.textContent = `${s.correct}/${s.total}`;
      head.append(name, val);

      const bar = document.createElement("div");
      bar.className = "skill-bar";
      const fill = document.createElement("div");
      fill.className = "skill-fill";
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);

      row.append(head, bar);
      wrap.appendChild(row);
    }
  }

  function renderTrajectory(r) {
    const svg = $("trajectory");
    const W = 560, H = 140, PAD = 10;
    const pts = r.trajectory;
    svg.innerHTML = "";
    if (pts.length < 2) { svg.parentElement.hidden = true; return; }
    svg.parentElement.hidden = false;

    const x = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
    const y = (t) => H - PAD - ((Math.max(-3.6, Math.min(3.6, t)) + 3.6) / 7.2) * (H - 2 * PAD);

    const ns = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.theta).toFixed(1)}`).join(" "));
    path.setAttribute("class", "traj-line");
    svg.appendChild(path);

    pts.forEach((p, i) => {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", x(i).toFixed(1));
      c.setAttribute("cy", y(p.theta).toFixed(1));
      c.setAttribute("r", "4");
      c.setAttribute("class", p.correct ? "traj-dot ok" : "traj-dot bad");
      const title = document.createElementNS(ns, "title");
      title.textContent = `Вопрос ${i + 1} (${p.level}): ${p.correct ? "верно" : "неверно"}`;
      c.appendChild(title);
      svg.appendChild(c);
    });
  }

  // ─────────────────────────── Инициализация ───────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    $("btn-start").addEventListener("click", startTest);
    $("btn-restart").addEventListener("click", startTest);
    $("btn-skip").addEventListener("click", () => answer(false, null));
    $("bank-size").textContent = QUESTIONS.length;
  });
})();
