/**
 * Адаптивный движок на основе IRT: 2PL-модель с единой для всех заданий
 * дискриминацией a (эквивалентна модели Раша в перемасштабированных логитах).
 *
 * Идея:
 *  1. Способность θ оценивается байесовски (EAP) после каждого ответа.
 *  2. Следующим выбирается вопрос с максимальной информацией Фишера
 *     вблизи текущей оценки θ (т.е. сложность ≈ текущему уровню),
 *     с балансировкой по навыкам и небольшой случайностью.
 *  3. Тест останавливается, когда стандартная ошибка оценки достаточно
 *     мала (уровень определён надёжно) либо достигнут максимум вопросов.
 */

const ENGINE_CONFIG = {
  minQuestions: 12,
  maxQuestions: 20,
  seTarget: 0.42,        // целевая стандартная ошибка θ для ранней остановки
  priorSd: 1.4,          // априорное распределение θ ~ N(0, priorSd²)
  discrimination: 1.6,   // параметр дискриминации a (2PL-модель)
  gridMin: -4.5,
  gridMax: 4.5,
  gridStep: 0.05,
  topPoolSize: 3,        // случайный выбор из N самых информативных вопросов
};

const CEFR_BANDS = [
  { level: "A0", max: -3.1 },
  { level: "A1", max: -2.1 },
  { level: "A2", max: -1.1 },
  { level: "B1", max: -0.1 },
  { level: "B2", max: 0.9 },
  { level: "C1", max: 1.9 },
  { level: "C2", max: Infinity },
];

class AdaptiveEngine {
  constructor(questions, config = ENGINE_CONFIG) {
    this.cfg = config;
    this.pool = questions.slice();
    this.answers = [];          // { question, correct, thetaAfter, seAfter }
    this.grid = [];
    for (let t = config.gridMin; t <= config.gridMax + 1e-9; t += config.gridStep) {
      this.grid.push(t);
    }
    // Апостериорное распределение; начинаем с априорного.
    this.posterior = this.grid.map((t) => this._prior(t));
    this._normalize();
    this.theta = 0;
    this.se = config.priorSd;
    this._updateEstimate();
  }

  _prior(t) {
    const s = this.cfg.priorSd;
    return Math.exp(-(t * t) / (2 * s * s));
  }

  /** Вероятность правильного ответа при способности theta и сложности b. */
  static pCorrect(theta, b, a = ENGINE_CONFIG.discrimination) {
    return 1 / (1 + Math.exp(-a * (theta - b)));
  }

  _normalize() {
    const sum = this.posterior.reduce((a, x) => a + x, 0);
    this.posterior = this.posterior.map((x) => x / sum);
  }

  _updateEstimate() {
    let mean = 0;
    for (let i = 0; i < this.grid.length; i++) mean += this.grid[i] * this.posterior[i];
    let variance = 0;
    for (let i = 0; i < this.grid.length; i++) {
      const d = this.grid[i] - mean;
      variance += d * d * this.posterior[i];
    }
    this.theta = mean;
    this.se = Math.sqrt(variance);
  }

  /** Навык, который пока задавался реже всего (для балансировки контента). */
  _preferredSkill() {
    const counts = { gram: 0, vok: 0, les: 0 };
    for (const a of this.answers) counts[a.question.skill]++;
    // Чтение — длинные задания, целимся примерно в 1 из 5 вопросов.
    const weights = { gram: 1, vok: 1, les: 0.45 };
    let best = null;
    let bestScore = Infinity;
    for (const skill of Object.keys(counts)) {
      const score = counts[skill] / weights[skill];
      if (score < bestScore) { bestScore = score; best = skill; }
    }
    return best;
  }

  /** Выбрать следующий вопрос или null, если пул исчерпан. */
  nextQuestion() {
    const used = new Set(this.answers.map((a) => a.question.id));
    const available = this.pool.filter((q) => !used.has(q.id));
    if (available.length === 0) return null;

    // Первый вопрос задаём чуть ниже среднего (~B1), чтобы не отпугнуть
    // новичков; дальше ориентируемся на текущую оценку θ.
    const target = this.answers.length === 0 ? -0.6 : this.theta;
    const info = (q) => {
      const p = AdaptiveEngine.pCorrect(target, q.b, this.cfg.discrimination);
      return p * (1 - p);
    };
    const ranked = available.slice().sort((a, b) => info(b) - info(a));

    // Балансировка навыков: среди информативных вопросов предпочитаем
    // недопредставленный навык, если он не сильно проигрывает по информации.
    const preferred = this._preferredSkill();
    const shortlist = ranked.slice(0, Math.max(this.cfg.topPoolSize * 2, 6));
    const preferredInShortlist = shortlist.filter((q) => q.skill === preferred);
    const candidates = (preferredInShortlist.length > 0 ? preferredInShortlist : shortlist)
      .slice(0, this.cfg.topPoolSize);

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /** Зафиксировать ответ и пересчитать оценку способности. */
  recordAnswer(question, correct) {
    for (let i = 0; i < this.grid.length; i++) {
      const p = AdaptiveEngine.pCorrect(this.grid[i], question.b, this.cfg.discrimination);
      this.posterior[i] *= correct ? p : 1 - p;
    }
    this._normalize();
    this._updateEstimate();
    this.answers.push({ question, correct, thetaAfter: this.theta, seAfter: this.se });
  }

  isFinished() {
    const n = this.answers.length;
    if (n >= this.cfg.maxQuestions) return true;
    if (n >= this.cfg.minQuestions && this.se <= this.cfg.seTarget) return true;
    if (n >= this.pool.length) return true; // пул исчерпан
    return false;
  }

  /**
   * Прогресс теста 0…1 для индикатора: максимум из доли заданных вопросов
   * и «точности измерения» (насколько SE упала от априорной к целевой).
   * Достигает 1 ровно тогда, когда тест готов завершиться.
   */
  progress() {
    const byCount = this.answers.length / this.cfg.maxQuestions;
    const byPrecision = Math.min(
      (this.cfg.priorSd - this.se) / (this.cfg.priorSd - this.cfg.seTarget),
      this.answers.length / this.cfg.minQuestions
    );
    return Math.max(0, Math.min(1, Math.max(byCount, byPrecision)));
  }

  /** Итог: уровень CEFR, уверенность и статистика. */
  result() {
    const correctCount = this.answers.filter((a) => a.correct).length;
    const total = this.answers.length;

    let level = "C2";
    for (const band of CEFR_BANDS) {
      if (this.theta <= band.max) { level = band.level; break; }
    }

    // «Уверенность» — вероятность того, что истинный θ лежит в границах
    // определённого уровня (масса апостериорного распределения в полосе).
    const band = CEFR_BANDS.find((b) => b.level === level);
    const idx = CEFR_BANDS.indexOf(band);
    const lo = idx === 0 ? -Infinity : CEFR_BANDS[idx - 1].max;
    const hi = band.max;
    let confidence = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] > lo && this.grid[i] <= hi) confidence += this.posterior[i];
    }

    // Разбивка по навыкам.
    const skills = {};
    for (const a of this.answers) {
      const s = a.question.skill;
      if (!skills[s]) skills[s] = { total: 0, correct: 0 };
      skills[s].total++;
      if (a.correct) skills[s].correct++;
    }

    return {
      level,
      theta: this.theta,
      se: this.se,
      confidence,
      total,
      correctCount,
      skills,
      trajectory: this.answers.map((a) => ({
        theta: a.thetaAfter,
        se: a.seAfter,
        correct: a.correct,
        level: a.question.level,
      })),
    };
  }
}

// Экспорт для Node (юнит-тесты/симуляции); в браузере — глобальные имена.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { AdaptiveEngine, ENGINE_CONFIG, CEFR_BANDS };
}
