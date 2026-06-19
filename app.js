(() => {
  const els = {
    balance: document.getElementById('balance'),
    currentBet: document.getElementById('currentBet'),
    wager: document.getElementById('wager'),
    betPlayer: document.getElementById('betPlayer'),
    betBanker: document.getElementById('betBanker'),
    betTie: document.getElementById('betTie'),

    dealBtn: document.getElementById('dealBtn'),
    resetBtn: document.getElementById('resetBtn'),
    message: document.getElementById('message'),

    playerCards: document.getElementById('playerCards'),
    bankerCards: document.getElementById('bankerCards'),
    playerTotal: document.getElementById('playerTotal'),
    bankerTotal: document.getElementById('bankerTotal'),

    roundResult: document.getElementById('roundResult'),
  };

  const state = {
    balance: 1000,
    betSide: null, // 'player' | 'banker' | 'tie'
    betAmount: 0,

    lock: false,
    // Baccarat shoe
    decks: 8,
    shoe: [],
    shoeIndex: 0,
    // optional cut card
    reshuffleWhenRemaining: 0.25, // fraction
  };

  const SUITS = ['♠', '♥', '♦', '♣'];
  const rankMap = {
    1: 'A',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
  };

  function setMessage(text, kind = '') {
    els.message.textContent = text;
    els.message.classList.remove('ok', 'bad');
    if (kind) els.message.classList.add(kind);
  }

  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  function cardValue(rank) {
    // Baccarat: Ace..9 => rank; 10/J/Q/K => 0
    if (rank >= 10) return 0;
    return rank % 10;
  }

  function totalMod10(cards) {
    const sum = cards.reduce((acc, c) => acc + cardValue(c.rank), 0);
    return sum % 10;
  }

  function makeFreshShoe() {
    // create ranks 1..13; each deck has 52 cards, but suit is cosmetic
    const shoe = [];
    for (let d = 0; d < state.decks; d++) {
      for (let s = 0; s < SUITS.length; s++) {
        for (let rank = 1; rank <= 13; rank++) {
          shoe.push({
            rank,
            display: `${rankMap[rank]}${SUITS[s]}`,
            value: cardValue(rank),
          });
        }
      }
    }

    // shuffle
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }

    state.shoe = shoe;
    state.shoeIndex = 0;
  }

  function drawCard() {
    if (!state.shoe.length) makeFreshShoe();

    const remaining = state.shoe.length - state.shoeIndex;
    const threshold = state.shoe.length * state.reshuffleWhenRemaining;
    if (remaining <= threshold) {
      makeFreshShoe();
    }

    return state.shoe[state.shoeIndex++];
  }

  function shouldBankerDraw(bankerCards, playerThird) {
    // banker total already computed mod10
    const bankerTotal = bankerCardsValue(bankerCards);

    // Tableau (standard):
    // Let p = playerThird value (0 if absent).
    // Banker draws on:
    // - totals 0..2 always draw
    // - total 3 draw unless p=8
    // - total 4 draw if p=2..7
    // - total 5 draw if p=4..7
    // - total 6 draw if p=6..7

    if (bankerTotal <= 2) return true;
    if (bankerTotal === 3) return playerThird !== 8;
    if (bankerTotal === 4) return playerThird >= 2 && playerThird <= 7;
    if (bankerTotal === 5) return playerThird >= 4 && playerThird <= 7;
    if (bankerTotal === 6) return playerThird === 6 || playerThird === 7;
    return false;
  }

  function bankerCardsValue(cards) {
    return cards.reduce((acc, c) => acc + c.value, 0) % 10;
  }

  function formatBets(bets) {
    const parts = [];
    if (bets.player) parts.push(`Player $${bets.player}`);
    if (bets.banker) parts.push(`Banker $${bets.banker}`);
    if (bets.tie) parts.push(`Tie $${bets.tie}`);
    if (parts.length === 0) return 'None';
    return parts.join(' | ');
  }

  function setBet(side) {
    if (state.lock) return;
    const wager = clampInt(els.wager.value, 1, 1_000_000);
    if (wager > state.balance) {
      setMessage('Insufficient balance for this wager.', 'bad');
      return;
    }

    if (!state.bets) state.bets = {};

    const key = side; // 'player' | 'banker' | 'tie'
    state.bets[key] = (state.bets[key] || 0) + wager;

    // Keep legacy fields in sync (used by existing dealing UI)
    state.betSide = side;
    state.betAmount = wager;

    els.currentBet.textContent = formatBets(state.bets);

    els.betPlayer.classList.toggle('active', !!state.bets.player);
    els.betBanker.classList.toggle('active', !!state.bets.banker);
    els.betTie.classList.toggle('active', !!state.bets.tie);

    setMessage(`Bet added: ${side.toUpperCase()} +$${wager}.`, '');
    els.dealBtn.disabled = false;
  }



  function placeOrResolve() {
    if (state.lock) return;
    const bets = state.bets || {};
    const totalWager = (bets.player || 0) + (bets.banker || 0) + (bets.tie || 0);
    if (totalWager <= 0) {
      setMessage('Place a bet first.', 'bad');
      return;
    }
    if (totalWager > state.balance) {
      setMessage('Insufficient balance.', 'bad');
      return;
    }

    state.lock = true;

    els.dealBtn.disabled = true;

    // Deal according to Baccarat
    // Player: B1 P2 P3?; Banker: B2 B3?
    const player = [drawCard(), drawCard()]; // P1, P3? We'll map after
    // Better approach: P1, B1, P2, B2, ...
    // Let's implement correctly:
    const playerCards = [drawCard()];
    const bankerCards = [drawCard()];
    playerCards.push(drawCard());
    bankerCards.push(drawCard());

    const playerTotal = totalMod10(playerCards);

    let playerThird = null;
    const playerThirdNeeded = playerTotal <= 5; // draw on 0-5
    if (playerThirdNeeded) {
      playerThird = drawCard();
      playerCards.push(playerThird);
    }

    const bankerTotalNow = totalMod10(bankerCards);
    let bankerThird = null;
    if (bankerTotalNow <= 5) {
      const playerThirdValue = playerThird ? playerThird.value : 0;
      const willDraw = shouldBankerDraw(bankerCards, playerThirdValue);
      if (willDraw) {
        bankerThird = drawCard();
        bankerCards.push(bankerThird);
      }
    } else {
      // banker stands on 7
      // but tableau rules above already cover draw decisions; do nothing
      // (We can still use shouldBankerDraw for correctness; totals 7+ will return false)
      const playerThirdValue = playerThird ? playerThird.value : 0;
      const willDraw = shouldBankerDraw(bankerCards, playerThirdValue);
      if (willDraw) {
        bankerThird = drawCard();
        bankerCards.push(bankerThird);
      }
    }

    const pTotal = totalMod10(playerCards);
    const bTotal = totalMod10(bankerCards);

    renderCards(playerCards, bankerCards, pTotal, bTotal);

    // Resolve betting (allow multiple bets)
    const betPlayer = bets.player || 0;
    const betBanker = bets.banker || 0;
    const betTie = bets.tie || 0;

    let delta = 0;
    let resultText = '';

    if (pTotal === bTotal) {
      if (betTie > 0) {
        delta += betTie * 8;
        setMessage('TIE! (8x)', 'ok');
      }
      // all non-tie bets lose
      delta -= betPlayer;
      delta -= betBanker;
      resultText = `TIE — ${delta >= 0 ? '+' : ''}$${delta}`;
    } else if (pTotal > bTotal) {
      if (betPlayer > 0) {
        delta += betPlayer;
        setMessage('PLAYER wins!', 'ok');
      }
      delta -= betBanker;
      delta -= betTie;
      resultText = `PLAYER wins — ${delta >= 0 ? ' +$' : '-$'}${Math.abs(delta)}`;
    } else {
      // Banker wins
      if (betBanker > 0) {
        delta += betBanker;
        setMessage('BANKER wins!', 'ok');
      }
      delta -= betPlayer;
      delta -= betTie;
      resultText = `BANKER wins — ${delta >= 0 ? ' +$' : '-$'}${Math.abs(delta)}`;
    }

    state.balance += delta;
    els.balance.textContent = `${state.balance}`;

    els.roundResult.textContent = resultText;


    // Reset bet lock for next round
    // Clear selected single bet (existing UI keeps one at a time)
    state.betSide = null;
    state.betAmount = 0;
    state.bets = {};
    els.currentBet.textContent = 'None';
    els.betPlayer.classList.remove('active');
    els.betBanker.classList.remove('active');
    els.betTie.classList.remove('active');



    if (state.balance <= 0) {
      setMessage('Balance depleted. Reset to play again.', 'bad');
      els.dealBtn.disabled = true;
    } else {
      els.dealBtn.disabled = false;
    }

    state.lock = false;
  }

  function renderCards(playerCards, bankerCards, pTotal, bTotal) {

    els.playerCards.innerHTML = playerCards
      .map((c) => `<div class="card">${c.display}</div>`)
      .join('');
    els.bankerCards.innerHTML = bankerCards
      .map((c) => `<div class="card">${c.display}</div>`)
      .join('');
    els.playerTotal.textContent = `${pTotal}`;
    els.bankerTotal.textContent = `${bTotal}`;
  }

  function reset() {
    if (state.lock) return;
    state.balance = 1000;
    state.betSide = null;
    state.betAmount = 0;
    state.lock = false;
    els.balance.textContent = `${state.balance}`;
    els.currentBet.textContent = 'None';
    els.playerCards.innerHTML = '—';
    els.bankerCards.innerHTML = '—';
    els.playerTotal.textContent = '—';
    els.bankerTotal.textContent = '—';
    els.roundResult.textContent = '—';
    els.betPlayer.classList.remove('active');
    els.betBanker.classList.remove('active');
    setMessage('Balance reset.', '');
    els.dealBtn.disabled = false;
  }

  // Wire events
  els.betPlayer.addEventListener('click', () => setBet('player'));
  els.betBanker.addEventListener('click', () => setBet('banker'));
  els.betTie.addEventListener('click', () => setBet('tie'));

  els.dealBtn.addEventListener('click', placeOrResolve);
  els.resetBtn.addEventListener('click', reset);

  els.wager.addEventListener('input', () => {
    if (state.betSide) {
      // update displayed bet if user adjusts wager
      setBet(state.betSide);
    }
  });

  // Init
  els.dealBtn.disabled = false;
  els.balance.textContent = `${state.balance}`;
  els.currentBet.textContent = 'None';

  setMessage('Place a bet, then press Deal.', '');
})();

