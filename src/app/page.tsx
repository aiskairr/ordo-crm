"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  FileCheck2,
  MessageCircle,
  Truck,
  Users2,
} from "lucide-react";
import styles from "./home.module.css";

const navItems = ["Продажи", "Отчеты", "Доставка", "Команда"];

const highlights = [
  { value: "МойСклад", label: "прямая интеграция" },
  { value: "0", label: "доплат за сотрудников" },
  { value: "10+", label: "рабочих разделов" },
  { value: "1", label: "единый интерфейс" },
];

const modules = [
  {
    title: "Продажи и рассрочка",
    text: "Оформление, смешанная оплата, чек и документ без лишних шагов.",
    icon: CreditCard,
  },
  {
    title: "Отчетность",
    text: "Продажи, отгрузки, прибыль, клиент и сотрудник в одном экране.",
    icon: BarChart3,
  },
  {
    title: "Акт сверки",
    text: "Долги, документы, оплаты и печать по контрагенту.",
    icon: FileCheck2,
  },
  {
    title: "Доставки",
    text: "Адрес, статус, состав заказа и ответственный без Excel.",
    icon: Truck,
  },
];

const points = [
  "Подключается поверх МойСклад, а не ломает ваш учет.",
  "Продавцу дается простой интерфейс без лишних вкладок.",
  "Руководитель получает контроль по продажам, сотрудникам и логистике.",
];

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

export default function HomePage() {
  return (
    <main className={styles.page}>
      <motion.div className={styles.shell} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandWord}>Ordo</span>
            <span className={styles.brandAccent}>CRM</span>
          </Link>
          <nav className={styles.nav}>
            {navItems.map((item) => (
              <a key={item} href="#overview">
                {item}
              </a>
            ))}
          </nav>
          <div className={styles.topbarActions}>
            <Link href="/project-info" className={styles.secondaryButton}>
              Что внутри
            </Link>
            <Link href="/login" className={styles.primaryButton}>
              Открыть CRM
            </Link>
          </div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Retail CRM поверх МойСклад</span>
            <h1>Управляй магазином в одном красивом рабочем интерфейсе.</h1>
            <p>
              Продажи, отчетность, доставка, акт сверки, сотрудники и клиентская работа
              собираются в одном слое поверх МойСклад.
            </p>
            <div className={styles.heroActions}>
              <Link href="/login" className={styles.primaryButton}>
                Войти в систему
              </Link>
              <Link href="/project-info" className={styles.ghostButton}>
                Смотреть обзор
              </Link>
            </div>
            <div className={styles.points}>
              {points.map((point) => (
                <div key={point} className={styles.point}>
                  <span />
                  <p>{point}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.heroVisual}>
            <motion.div className={styles.floatingCardDark} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
              <span>Операционный слой</span>
              <strong>Продажа, логистика, отчет</strong>
              <small>без лишних окон и ручного контроля</small>
            </motion.div>

            <div className={styles.heroGlassOrb} />

            <motion.div className={styles.heroMediaFrame} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.55 }}>
              <Image
                src="/landing-hero.png"
                alt="Интерфейс Ordo CRM"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                className={styles.heroImage}
              />
            </motion.div>

            <motion.div className={styles.statsBar} initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26, duration: 0.55 }}>
              {highlights.map((item) => (
                <div key={item.label} className={styles.statTile}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        <section id="overview" className={styles.mosaic}>
          <motion.article className={`${styles.panel} ${styles.panelDark}`} {...fadeUp}>
            <span className={styles.panelTag}>Что это</span>
            <h2>Система для магазина, где МойСклад остается базой, а Ordo CRM закрывает реальную операционку.</h2>
            <p>
              Тут не про лишнюю витрину. Тут про быстрый рабочий слой для продавца,
              управляющего, бухгалтера и логиста.
            </p>
            <Link href="/project-info" className={styles.panelLink}>
              Открыть инфо-страницу <ArrowRight size={16} />
            </Link>
          </motion.article>

          <motion.article className={`${styles.panel} ${styles.panelLight}`} {...fadeUp}>
            <div className={styles.peopleCard}>
              <div className={styles.peopleAvatar} />
              <div>
                <span className={styles.microLabel}>Команда</span>
                <strong>Сколько угодно внутренних сотрудников</strong>
                <p>Без отдельной оплаты за каждого пользователя в интерфейсе CRM.</p>
              </div>
            </div>
            <div className={styles.metricPill}>
              <Users2 size={18} />
              <span>Роли, доступы, контроль действий</span>
            </div>
          </motion.article>

          <motion.article className={`${styles.panel} ${styles.panelMedium}`} {...fadeUp}>
            <div className={styles.moduleGrid}>
              {modules.map(({ title, text, icon: Icon }) => (
                <div key={title} className={styles.moduleCard}>
                  <div className={styles.moduleIcon}>
                    <Icon size={18} />
                  </div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </motion.article>

          <motion.article className={`${styles.panel} ${styles.panelGlass}`} {...fadeUp}>
            <span className={styles.panelTag}>Проблема</span>
            <h3>Когда продажи, чеки, доставки и отчеты живут в разных местах, магазин начинает терять скорость.</h3>
            <p>
              Ordo CRM собирает это в один поток: создать документ, отправить чек, проконтролировать доставку, увидеть результат.
            </p>
          </motion.article>

          <motion.article className={`${styles.panel} ${styles.panelAccent}`} {...fadeUp}>
            <div className={styles.accentMetric}>
              <span>Основная выгода</span>
              <strong>Меньше ручной работы. Больше контроля.</strong>
            </div>
            <div className={styles.metricList}>
              <div><CreditCard size={18} /> Продажа</div>
              <div><Truck size={18} /> Доставка</div>
              <div><MessageCircle size={18} /> Клиент</div>
              <div><BarChart3 size={18} /> Аналитика</div>
            </div>
          </motion.article>
        </section>
      </motion.div>
    </main>
  );
}
