/**
 * Санити-чек банка заданий + симуляция адаптивного теста.
 *
 * Запуск: node tests/simulate.js
 * Зависимостей нет. Завершается с кодом 1, если найдены проблемы
 * в банке или точность классификации упала ниже порога.
 */
const path = require("path");
const { QUESTIONS } = require(path.join(__dirname, "..", "js", "questions.js"));
const { AdaptiveEngine } = require(path.join(__dirname, "..", "js", "engine.js"));

let failures = 0;
function check(ok, msg) {
  if (!ok) { console.error("FAIL:", msg); failures++; }
}

// ─────────── Проверки банка заданий ───────────
const ids = new Set();
for (const q of QUESTIONS) {
  check(!ids.has(q.id), `дубликат id: ${q.id}`);
  ids.add(q.id);
  check(q.opts.length === 4, `${q.id}: вариантов не 4`);
  check(new Set(q.opts).size === q.opts.length, `${q.id}: одинаковые варианты`);
  check(["gram", "vok", "les"].includes(q.skill), `${q.id}: неизвестный навык ${q.skill}`);
  check(typeof q.b === "number" && q.b > -4 && q.b < 4, `${q.id}: сложность b вне диапазона`);
  check(["A1", "A2", "B1", "B2", "C1", "C2"].includes(q.level), `${q.id}: неизвестный уровень`);
}
console.log(`Банк: ${QUESTIONS.length} заданий, проблем: ${failures}`);

// ─────────── Симуляция ───────────
function simulate(trueTheta) {
  const e = new AdaptiveEngine(QUESTIONS);
  while (!e.isFinished()) {
    const q = e.nextQuestion();
    if (!q) break;
    const p = AdaptiveEngine.pCorrect(trueTheta, q.b);
    e.recordAnswer(q, Math.random() < p);
  }
  return e.result();
}

// Истинный θ в центре каждого уровня → ожидаемый уровень.
const cases = [
  { theta: -2.6, expect: "A1" },
  { theta: -1.6, expect: "A2" },
  { theta: -0.5, expect: "B1" },
  { theta: 0.4, expect: "B2" },
  { theta: 1.4, expect: "C1" },
  { theta: 2.6, expect: "C2" },
];
const N = 300;
const MIN_ACCURACY = 0.6; // порог с запасом; по факту 75–91 %

for (const { theta, expect } of cases) {
  const counts = {};
  let nSum = 0;
  for (let i = 0; i < N; i++) {
    const r = simulate(theta);
    counts[r.level] = (counts[r.level] || 0) + 1;
    nSum += r.total;
  }
  const acc = (counts[expect] || 0) / N;
  const dist = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([l, c]) => `${l}:${Math.round((c / N) * 100)}%`).join(" ");
  console.log(`θ=${theta} (${expect}): ${dist} | точность=${Math.round(acc * 100)}%, ср. длина=${(nSum / N).toFixed(1)}`);
  check(acc >= MIN_ACCURACY, `точность для ${expect} ниже ${MIN_ACCURACY * 100}%`);
}

// ─────────── Крайние случаи ───────────
const allRight = new AdaptiveEngine(QUESTIONS);
while (!allRight.isFinished()) allRight.recordAnswer(allRight.nextQuestion(), true);
check(allRight.result().level === "C2", "все ответы верны → должен быть C2");

const allWrong = new AdaptiveEngine(QUESTIONS);
while (!allWrong.isFinished()) allWrong.recordAnswer(allWrong.nextQuestion(), false);
check(allWrong.result().level === "A0", "все ответы неверны → должен быть A0");

// Прогресс монотонно достигает 1 к моменту завершения.
const e = new AdaptiveEngine(QUESTIONS);
check(e.progress() === 0, "прогресс до начала должен быть 0");
while (!e.isFinished()) e.recordAnswer(e.nextQuestion(), Math.random() < 0.5);
check(e.progress() === 1, "прогресс по завершении должен быть 1");

console.log(failures === 0 ? "OK" : `Ошибок: ${failures}`);
process.exit(failures ? 1 : 0);
