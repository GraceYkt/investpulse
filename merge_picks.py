"""Дополняет idea-picks.json курируемыми подборками: вклады, фонды, акции, золото."""
import json

with open("invest-app/src/data/idea-picks.json", encoding="utf-8") as f:
    picks = json.load(f)

T_BANK_FUNDS = "https://www.tbank.ru/invest/funds/{}/"
T_BANK_STOCKS = "https://www.tbank.ru/invest/stocks/{}/"

picks["1"] = [  # Накопительные счета и вклады (sravni.ru / lenta.ru, 22.10.2026)
    {"kind": "deposit", "name": "ПСБ · Народный вклад", "desc": "до 30% · 32 дня · 10–50 тыс. ₽ · новые клиенты", "buyUrl": "https://www.psbank.ru/"},
    {"kind": "deposit", "name": "Альфа-Банк · Альфа-Вклад Зарплатный", "desc": "до 19,83% · 62 дня · зарплатные клиенты", "buyUrl": "https://alfabank.ru/"},
    {"kind": "deposit", "name": "Сбербанк · Выгодный старт +", "desc": "до 19% · 91 день · до 100 тыс. ₽ · новые клиенты", "buyUrl": "https://www.sberbank.ru/"},
    {"kind": "deposit", "name": "Яндекс Банк · Сейв", "desc": "до 17% · 14–730 дней · от 10 тыс. ₽", "buyUrl": "https://bank.yandex.ru/"},
    {"kind": "deposit", "name": "Газпромбанк · Ключевой момент", "desc": "до 16% · плавающая ставка · до 3 лет · от 100 тыс. ₽", "buyUrl": "https://www.gazprombank.ru/"},
]

picks["2"] = [  # Фонды денежного рынка (BondRadar, доходность за 12 мес. на 04.10.2026)
    {"kind": "fund", "name": "SBMM · Фонд Сберегательный (УК Первая)", "desc": "+16,20% за 12 мес. · комиссия 0,30% · СЧА 331 млрд", "buyUrl": T_BANK_FUNDS.format("SBMM")},
    {"kind": "fund", "name": "LQDT · Ликвидность (ВИМ)", "desc": "+16,08% за 12 мес. · комиссия 0,29% · СЧА 500+ млрд", "buyUrl": T_BANK_FUNDS.format("LQDT")},
    {"kind": "fund", "name": "AMNR · Накопительный (АТОН)", "desc": "+15,99% за 12 мес. · комиссия 0,29%", "buyUrl": T_BANK_FUNDS.format("AMNR")},
    {"kind": "fund", "name": "FINC · Денежный рынок + (Финстар)", "desc": "+15,90% за 12 мес. · комиссия 0,31%", "buyUrl": T_BANK_FUNDS.format("FINC")},
    {"kind": "fund", "name": "BCSD · Денежный рынок (БКС)", "desc": "+15,80% за 12 мес. · комиссия 0,50%", "buyUrl": T_BANK_FUNDS.format("BCSD")},
]

picks["7"] = [  # Дивидендные акции (investmint.ru, 20.10.2026)
    {"kind": "stock", "name": "МТС (MTSS)", "desc": "дивдоходность 20,1% · 18 лет без пропусков выплат", "buyUrl": T_BANK_STOCKS.format("MTSS")},
    {"kind": "stock", "name": "Транснефть ап (TRNFP)", "desc": "дивдоходность 19,3% · 18 лет, растёт 5 лет подряд", "buyUrl": T_BANK_STOCKS.format("TRNFP")},
    {"kind": "stock", "name": "Сбербанк (SBER)", "desc": "дивдоходность 12,8% · лидер отрасли", "buyUrl": T_BANK_STOCKS.format("SBER")},
    {"kind": "stock", "name": "Лукойл (LKOH)", "desc": "дивдоходность 11,2% · «дивидендный король»", "buyUrl": T_BANK_STOCKS.format("LKOH")},
    {"kind": "stock", "name": "Башинформсвязь ап (BISVP)", "desc": "дивдоходность 10,2% · 18 лет выплат", "buyUrl": T_BANK_STOCKS.format("BISVP")},
]

picks["8"] = [  # Нефтегаз с дисконтом (investmint.ru, 20.10.2026)
    {"kind": "stock", "name": "Лукойл (LKOH)", "desc": "дивдоходность 11,2% · 100% СДДП, прозрачная политика", "buyUrl": T_BANK_STOCKS.format("LKOH")},
    {"kind": "stock", "name": "Башнефть ап (BANEP)", "desc": "дивдоходность 8,7% · 18 лет выплат", "buyUrl": T_BANK_STOCKS.format("BANEP")},
    {"kind": "stock", "name": "Газпром нефть (SIBN)", "desc": "дивдоходность 7,9% · сильный FCF", "buyUrl": T_BANK_STOCKS.format("SIBN")},
    {"kind": "stock", "name": "Новатэк (NVTK)", "desc": "дивдоходность 7,3% · крупнейший независимый газовик", "buyUrl": T_BANK_STOCKS.format("NVTK")},
    {"kind": "stock", "name": "Татнефть (TATN)", "desc": "дивдоходность 5,4% · 18 лет, растёт 4 года подряд", "buyUrl": T_BANK_STOCKS.format("TATN")},
]

picks["9"] = [  # Золото: фонд + спот + золотодобытчики
    {"kind": "fund", "name": "TGLD · БПИФ «Т-Инвестиции Золото»", "desc": "биржевой фонд на золото · комиссия 0,74%", "buyUrl": T_BANK_FUNDS.format("TGLD")},
    {"kind": "fund", "name": "GLDRUB_TOM · биржевое золото (спот)", "desc": "золото в рублях, расчёты TOM · без комиссии УК", "buyUrl": "https://www.moex.com/ru/issue/GLDRUB_TOM.aspx"},
    {"kind": "stock", "name": "Полюс (PLZL)", "desc": "крупнейший золотодобытчик РФ · бизнес-риск эмитента", "buyUrl": T_BANK_STOCKS.format("PLZL")},
    {"kind": "stock", "name": "Селигдар (SELG)", "desc": "золото и олово · облигации рейтинга А+", "buyUrl": T_BANK_STOCKS.format("SELG")},
    {"kind": "stock", "name": "Высочайший (GCHE)", "desc": "золотодобыча · малый бизнес, высокая волатильность", "buyUrl": T_BANK_STOCKS.format("GCHE")},
]

with open("invest-app/src/data/idea-picks.json", "w", encoding="utf-8") as f:
    json.dump(picks, f, ensure_ascii=False, indent=1)

for k in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]:
    arr = picks.get(k, [])
    print(f"rank {k}: {len(arr)} позиций")
print("merged -> invest-app/src/data/idea-picks.json")
