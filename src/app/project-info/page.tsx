import Image from "next/image";
import Link from "next/link";
import {
  Banknote,
  BarChart3,
  Calculator,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileSpreadsheet,
  MessageCircle,
  PackageSearch,
  Play,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import styles from "./project-info.module.css";

const problems = [
  {
    title: "Прибыль не видна",
    text: "Оборот есть, чистых денег нет в одном экране.",
  },
  {
    title: "Долги теряются",
    text: "Рассрочка, предоплата и остаток разбросаны по документам.",
  },
  {
    title: "Нет единого процесса",
    text: "Чек, клиент, доставка и фото живут в разных местах.",
  },
  {
    title: "Отчеты долгие",
    text: "Чтобы собрать картину по магазину, нужно слишком много ручной сверки.",
  },
];

const modules = [
  {
    icon: ShoppingCart,
    title: "Продажи",
    problem: "Один экран вместо ручного заполнения.",
    result: "Товар, оплата, клиент, чек и документ в одном потоке.",
  },
  {
    icon: WalletCards,
    title: "Продать в долг",
    problem: "Долг не смешивается с обычной продажей.",
    result: "Предоплата, остаток и клиент фиксируются отдельно.",
  },
  {
    icon: BarChart3,
    title: "Отчетность",
    problem: "Не просто оборот, а деньги по факту.",
    result: "Документы, оплаты, остатки, товары и прибыль.",
  },
  {
    icon: FileCheck2,
    title: "Акт сверки",
    problem: "Должники собираются автоматически.",
    result: "Клиент, документы, оплаты и остаток в одном месте.",
  },
  {
    icon: Truck,
    title: "Доставки",
    problem: "Продажа сразу уходит в логистику.",
    result: "Адрес, статус, клиент и сумма без ручного копирования.",
  },
  {
    icon: Clock3,
    title: "Посещаемость",
    problem: "Смена открыта, статус понятен.",
    result: "Кто на работе, кто опоздал, сколько уже в смене.",
  },
  {
    icon: Banknote,
    title: "Банковские комиссии",
    problem: "Комиссия не съедает прибыль незаметно.",
    result: "Банк, оборот, комиссия и чистая сумма по каждому типу.",
  },
  {
    icon: UsersRound,
    title: "Сотрудники и доступ",
    problem: "Каждый видит только свое.",
    result: "Страницы и права назначаются точечно.",
  },
];

const extras = [
  { icon: MessageCircle, title: "WhatsApp", text: "База клиентов и массовая рассылка." },
  { icon: Calculator, title: "Расчет цен", text: "Шаблоны групп и массовое обновление." },
  { icon: FileSpreadsheet, title: "Счета юрлицам", text: "Быстрое формирование документов." },
  { icon: PackageSearch, title: "Таможня", text: "Себестоимость партии по весу и объему." },
  { icon: ReceiptText, title: "Чеки в Telegram", text: "Фото чека сразу уходит в группу." },
  { icon: ShieldCheck, title: "Контроль доступа", text: "Сотрудник видит только разрешенные разделы." },
];

const demoFlow = [
  "Обычная продажа за 40 секунд.",
  "Продажа в долг и автоматический контроль остатка.",
  "Отчетность с прибылью, клиентами и товарами.",
  "Доп. модули: доставки, WhatsApp, цены, сотрудники.",
];

const spotlight = [
  "Продажа и отгрузка по правильной логике",
  "Чистая прибыль с учетом комиссий и закупки",
  "Фото чека сразу в Telegram",
  "МойСклад остается базой, CRM ускоряет работу",
];

export default function ProjectInfoPage() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.logo}>
          <Image src="/ordo-logo.svg" alt="Ordo CRM" width={142} height={44} priority />
        </Link>
        <nav>
          <a href="#problems">Проблемы</a>
          <a href="#modules">Разделы</a>
          <a href="#demo">Демо</a>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <span>CRM поверх МойСклад</span>
          <h1>Магазин выглядит сильнее, когда продавец работает быстро, а владелец видит деньги сразу</h1>
          <p>Продажи, долги, сотрудники, чеки и прибыль в одном чистом интерфейсе.</p>
          <div className={styles.heroActions}>
            <Link href="/sales">Открыть CRM</Link>
            <a href="#modules"><Play size={16} /> Смотреть модули</a>
          </div>
          <div className={styles.heroChips}>
            {spotlight.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div className={styles.heroPanel}>
          <div className={styles.panelBadge}>Live overview</div>
          <div className={styles.panelHeader}>
            <span>Контроль за 1 экран</span>
            <strong>Что видит владелец</strong>
          </div>
          <div className={styles.kpiGrid}>
            <article>
              <small>Продажи</small>
              <b>Документ, чек, клиент</b>
            </article>
            <article>
              <small>Деньги</small>
              <b>Оплачено, долг, комиссия</b>
            </article>
            <article>
              <small>Прибыль</small>
              <b>С учетом закупки и банка</b>
            </article>
            <article>
              <small>Команда</small>
              <b>Смены, доступ, доставка</b>
            </article>
          </div>
          <div className={styles.checkList}>
            <span><CheckCircle2 size={18} /> Не заменяет МойСклад, а усиливает его</span>
            <span><CheckCircle2 size={18} /> Убирает ручные действия продавца</span>
            <span><CheckCircle2 size={18} /> Демо можно показать за 5 минут</span>
          </div>
        </div>
      </section>

      <section className={styles.metricBand}>
        <article><strong>1</strong><span>рабочий экран продажи</span></article>
        <article><strong>8+</strong><span>ключевых модулей магазина</span></article>
        <article><strong>0</strong><span>лишних действий для продавца</span></article>
        <article><strong>100%</strong><span>контроль документов и оплат</span></article>
      </section>

      <section className={styles.section} id="problems">
        <div className={styles.sectionTitle}>
          <span>Почему это цепляет</span>
          <h2>То, что магазин чувствует каждый день</h2>
        </div>
        <div className={styles.problemGrid}>
          {problems.map((problem) => (
            <article key={problem.title}>
              <h3>{problem.title}</h3>
              <p>{problem.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} id="modules">
        <div className={styles.sectionTitle}>
          <span>Основные разделы</span>
          <h2>Ключевые страницы, которые продают систему сами</h2>
        </div>
        <div className={styles.moduleGrid}>
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <article key={module.title}>
                <div className={styles.moduleIcon}><Icon size={22} /></div>
                <h3>{module.title}</h3>
                <p>{module.problem}</p>
                <p><b>{module.result}</b></p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.blueBand}>
        <div>
          <span>Главный месседж</span>
          <h2>МойСклад хранит документы. Ordo CRM делает магазин быстрым и понятным.</h2>
        </div>
        <p>Для продавца это скорость. Для владельца это контроль. Для клиента это аккуратный сервис.</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>Дополнительные модули</span>
          <h2>То, что усиливает проект на фоне обычного учета</h2>
        </div>
        <div className={styles.extraGrid}>
          {extras.map((extra) => {
            const Icon = extra.icon;
            return (
              <article key={extra.title}>
                <Icon size={22} />
                <h3>{extra.title}</h3>
                <p>{extra.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.demo} id="demo">
        <div className={styles.sectionTitle}>
          <span>Как показывать клиенту</span>
          <h2>Короткий wow-сценарий без перегруза текстом</h2>
        </div>
        <div className={styles.demoCard}>
          {demoFlow.map((step, index) => (
            <article key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
