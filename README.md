# MicroWins

[MicroWins](https://github.com/MonsterMarian/MicroWins) je webová a mobilní aplikace pro sledování tvých cílů a úspěchů. Skládá se ze dvou hlavních částí:

1. **Projekty** - Sledování velkých cílů. Můžeš si projekt rozdělit na menší měřitelné úkoly, sledovat postup, tempo, graf vývoje a deník změn.
2. **Strom winů** - Systém pro evidenci každodenních úspěchů ("microwinů"). Podporuje tři typy záznamů:
   - **Číselné** (např. počet kilometrů, prodejů - eviduje se překonání dosavadního rekordu)
   - **Zaškrtávací** (udělal/neudělal, pro budování návyků)
   - **Jednorázové** (významné milníky, které se staly jednou)

Díky propracované **analýze** můžeš sledovat své "streaky" (série dnů bez přerušení), prohlížet si úspěchy v kalendáři a vidět rozložení podle kategorií.

Všechna data zůstávají u tebe – aplikace funguje čistě nad `localStorage`, je plně offline a nepotřebuješ žádný účet. O svá data nepřijdeš, protože si je můžeš kdykoliv exportovat i importovat.

---

## 🚀 Spuštění

Pro lokální běh projektu:

```bash
npm install
npm run dev
```

Aplikace poběží na `http://localhost:3000`.

## 🛠 Technologie

- Next.js 15 (App Router)
- React 19
- TypeScript (strict mode)
- Tailwind CSS 4
- Vitest pro testování doménové logiky
- Capacitor (pro běh jako nativní Android aplikace)

Doménová logika (pravidla winů, výpočty projektů) je plně oddělena od Reactu a důkladně pokryta testy. Uživatelské rozhraní je postavené na principech `shadcn/ui` s důrazem na čistý vzhled, rychlost a přehlednost. Podporuje tmavý i světlý režim.
