'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

const API = 'https://movies-api.accel.li/api/v2';
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://open.demonii.com:1337/announce',
];

function magnet(hash, title) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}&${TRACKERS.map(t => 'tr=' + encodeURIComponent(t)).join('&')}`;
}

export default function Home() {
  const [scrolled, setScrolled] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [streaming, setStreaming] = useState(null);
  const [loading, setLoading] = useState(true);
  const [movies, setMovies] = useState({ trending: [], popular: [], latest: [], action: [], comedy: [] });
  const [searchResults, setSearchResults] = useState(null);
  const [streamStatus, setStreamStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [peers, setPeers] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heroIdx, setHeroIdx] = useState(0);
  const videoRef = useRef(null);
  const clientRef = useRef(null);
  const rowRefs = useRef({});

  // Rotate hero every 8 seconds
  useEffect(() => {
    if (movies.trending.length === 0) return;
    const t = setInterval(() => {
      setHeroIdx(i => (i + 1) % Math.min(movies.trending.length, 8));
    }, 8000);
    return () => clearInterval(t);
  }, [movies.trending]);

  // Fetch movies
  useEffect(() => {
    async function load() {
      try {
        const [trend, pop, latest, action, comedy] = await Promise.all([
          fetch(`${API}/list_movies.json?sort_by=download_count&limit=20`).then(r => r.json()),
          fetch(`${API}/list_movies.json?sort_by=like_count&limit=20`).then(r => r.json()),
          fetch(`${API}/list_movies.json?sort_by=date_added&limit=20`).then(r => r.json()),
          fetch(`${API}/list_movies.json?genre=action&sort_by=download_count&limit=20`).then(r => r.json()),
          fetch(`${API}/list_movies.json?genre=comedy&sort_by=download_count&limit=20`).then(r => r.json()),
        ]);
        setMovies({
          trending: trend?.data?.movies || [],
          popular: pop?.data?.movies || [],
          latest: latest?.data?.movies || [],
          action: action?.data?.movies || [],
          comedy: comedy?.data?.movies || [],
        });
      } catch (e) { console.error('API error:', e); }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`${API}/list_movies.json?query_term=${encodeURIComponent(search)}&limit=40`);
      const data = await res.json();
      setSearchResults(data?.data?.movies || []);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Lock scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // Row scroll
  const scrollRow = useCallback((rowKey, dir) => {
    const el = rowRefs.current[rowKey];
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  }, []);

  async function startStream(movie, torrent) {
    setStreamStatus('Bağlanıyor...');
    setProgress(0);
    setPeers(0);
    setStreaming({ movie, torrent });
    setSelected(null);
    if (clientRef.current) { clientRef.current.destroy(); }

    const client = await createClient();
    if (!client) { setStreamStatus('WebRTC desteklenmiyor.'); return; }
    clientRef.current = client;

    const url = magnet(torrent.hash, movie.title_long || movie.title);
    setStreamStatus('⏳ Torrent bulunuyor (peers aranıyor)...');

    client.add(url, (torrentObj) => {
      // Priority: mp4 > webm > mkv > largest file
      const videoFile = torrentObj.files.find(f => f.name.endsWith('.mp4')) 
        || torrentObj.files.find(f => f.name.endsWith('.webm'))
        || torrentObj.files.find(f => f.name.endsWith('.mkv'))
        || torrentObj.files.reduce((a, b) => (a.length > b.length ? a : b), torrentObj.files[0]);

      if (!videoFile) {
        setStreamStatus('❌ Video dosyası bulunamadı.');
        return;
      }

      const ext = videoFile.name.split('.').pop().toLowerCase();
      
      if (ext === 'mp4' || ext === 'webm') {
        // Browser can play directly — use blob URL
        videoFile.getBlobURL((err, url) => {
          if (err || !url) {
            // Fallback: stream via renderTo
            if (videoRef.current) {
              videoRef.current.src = '';
              videoFile.renderTo(videoRef.current, { autoplay: true, controls: true });
            }
            return;
          }
          if (videoRef.current) {
            videoRef.current.src = url;
            videoRef.current.play();
          }
        });
        setStreamStatus('▶ Oynatılıyor...');
      } else {
        // mkv/avi — try renderTo (works in some browsers with codecs)
        setStreamStatus('⚠️ ' + ext.toUpperCase() + ' formatı — codec desteğine bağlı olarak oynatılabilir...');
        if (videoRef.current) {
          videoFile.renderTo(videoRef.current, { autoplay: true, controls: true });
        }
        // After 15s, if no progress, show hint
        setTimeout(() => {
          if (progress < 0.02) {
            setStreamStatus('⚠️ Bu format tarayıcıda oynatılamıyor olabilir. MP4 kalitesini deneyin.');
          }
        }, 15000);
      }

      torrentObj.on('download', () => {
        setProgress(torrentObj.progress);
        setPeers(torrentObj.numPeers);
        const sp = (torrentObj.downloadSpeed / 1048576).toFixed(1);
        setStreamStatus(`⬇ %${Math.round(torrentObj.progress * 100)} · ${torrentObj.numPeers} peers · ${sp} MB/s`);
      });
    });
    client.on('error', (err) => setStreamStatus('❌ ' + err.message));
  }

  function closeStream() {
    if (clientRef.current) { clientRef.current.destroy(); clientRef.current = null; }
    setStreaming(null); setStreamStatus(''); setProgress(0); setPeers(0);
  }

  const isSearching = search.trim().length > 0;
  const rows = isSearching
    ? [{ key: 'search', title: `"${search}" için sonuçlar (${searchResults?.length || 0})`, items: searchResults || [] }]
    : [
        { key: 'trending', title: '🔥 En Çok İndirilenler', items: movies.trending },
        { key: 'popular', title: '⭐ En Beğenilenler', items: movies.popular },
        { key: 'latest', title: '🆕 Son Eklenenler', items: movies.latest },
        { key: 'action', title: '💥 Aksiyon', items: movies.action },
        { key: 'comedy', title: '😂 Komedi', items: movies.comedy },
      ];

  const heroMovie = movies.trending[heroIdx];

  function MovieCard({ m }) {
    const seeds = m.torrents?.[0]?.seeds || 0;
    const peers = m.torrents?.[0]?.peers || 0;
    return (
      <div className="movie-card" onClick={() => setSelected(m)}>
        <img src={m.medium_cover_image || m.small_cover_image} alt={m.title} loading="lazy" />
        <div className="movie-card-overlay">
          <div className="movie-card-title">{m.title_english || m.title}</div>
          <div className="movie-card-rating">⭐ {m.rating} · {m.year}</div>
          <div className="movie-card-peers">🌱 {seeds} seed · 👥 {peers} peer</div>
        </div>
      </div>
    );
  }

  function Row({ row }) {
    return (
      <div className="row" id={row.key}>
        <div className="row-header">
          <h2 className="row-title">{row.title}</h2>
        </div>
        <div className="row-wrapper">
          <button className="row-arrow row-arrow-left" onClick={() => scrollRow(row.key, -1)} aria-label="Sol">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="row-cards" ref={el => rowRefs.current[row.key] = el}>
            {row.items.map(m => <MovieCard key={m.id} m={m} />)}
          </div>
          <button className="row-arrow row-arrow-right" onClick={() => scrollRow(row.key, 1)} aria-label="Sağ">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Navbar */}
      <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="navbar-inner">
          <a href="#" className="navbar-logo">ZYFLIX</a>
          <ul className={`navbar-links ${menuOpen ? 'mobile-open' : ''}`}>
            <li><a href="#" onClick={() => setMenuOpen(false)}>Ana Sayfa</a></li>
            <li><a href="#trending" onClick={() => setMenuOpen(false)}>Popüler</a></li>
            <li><a href="#latest" onClick={() => setMenuOpen(false)}>Yeniler</a></li>
            <li><a href="#action" onClick={() => setMenuOpen(false)}>Aksiyon</a></li>
          </ul>
          <div className="navbar-right">
            <input className="navbar-search" type="text" placeholder="🔍 Film ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="navbar-avatar">Z</div>
            <button className={`hamburger ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
              <span></span><span></span><span></span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile overlay */}
      <div className={`mobile-overlay ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen(false)} />

      {/* Loading */}
      {loading && (
        <div className="loading-screen">
          <div className="loading-logo">ZYFLIX</div>
          <div className="loading-text">Filmler yükleniyor...</div>
        </div>
      )}

      {/* Hero — only when not searching */}
      {!loading && !isSearching && heroMovie && (
        <section className="hero" key={heroMovie.id}>
          <div className="hero-bg">
            <img src={heroMovie.background_image_original || heroMovie.large_cover_image} alt={heroMovie.title} />
          </div>
          <div className="hero-overlay" />
          <div className="hero-content">
            <div className="hero-badge">🎬 Öne Çıkan ({heroIdx + 1}/{Math.min(movies.trending.length, 8)})</div>
            <h1 className="hero-title">{heroMovie.title_long || heroMovie.title}</h1>
            <p className="hero-desc">{heroMovie.summary || heroMovie.synopsis || `${heroMovie.title} (${heroMovie.year}) — ${heroMovie.genres?.join(', ')}`}</p>
            <div className="hero-meta">
              <span className="hero-rating">⭐ {heroMovie.rating}/10</span>
              <span>{heroMovie.year}</span>
              <span>{heroMovie.runtime} dk</span>
              <span>{heroMovie.genres?.join(' · ')}</span>
            </div>
            <div className="hero-buttons">
              <button className="hero-btn hero-btn-play" onClick={() => setSelected(heroMovie)}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>İzle
              </button>
              <button className="hero-btn hero-btn-info" onClick={() => setSelected(heroMovie)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>Detaylar
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Content */}
      {!loading && (
        <div className={`content-section ${isSearching ? 'search-mode' : ''}`}>
          {rows.map(row => row.items.length > 0 ? <Row key={row.key} row={row} /> : null)}
          {isSearching && searchResults && searchResults.length === 0 && (
            <div className="no-results">Sonuç bulunamadı 😔</div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selected && !streaming && (
        <div className="modal-overlay active" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            <img className="modal-poster" src={selected.background_image_original || selected.large_cover_image} alt={selected.title} />
            <div className="modal-body">
              <h2 className="modal-title">{selected.title_long || selected.title}</h2>
              <div className="modal-meta">
                <span className="match">⭐ {selected.rating}/10</span>
                <span>{selected.year}</span>
                <span>{selected.runtime} dk</span>
                <span>{selected.genres?.join(' · ')}</span>
              </div>
              <p className="modal-desc">{selected.summary || selected.synopsis || 'Açıklama bulunmuyor.'}</p>
              <div className="quality-section">
                <div className="quality-label">▶ İzleme kalitesi seç:</div>
                <div className="quality-list">
                  {selected.torrents?.sort((a,b) => parseInt(a.quality) - parseInt(b.quality)).map((t, i) => (
                    <button key={i} className="quality-btn" onClick={() => startStream(selected, t)}>
                      <span className="quality-main">{t.quality} · {t.type}</span>
                      <span className="quality-info">{t.size} · 🌱{t.seeds} · 👥{t.peers}</span>
                      <span className="quality-format">{t.video_codec} {t.bit_depth}bit</span>
                    </button>
                  ))}
                </div>
                <p className="quality-hint">💡 Yüksek seed = daha hızlı açılır. P2P torrent stream — WebTorrent.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stream Player */}
      {streaming && (
        <div className="modal-overlay active" style={{ background: 'rgba(0,0,0,0.97)' }}>
          <div className="modal stream-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeStream}>✕</button>
            <div className="video-wrapper">
              <video ref={videoRef} controls autoPlay playsInline crossOrigin="anonymous" />
              {progress < 0.01 && (
                <div className="video-loading">
                  <div className="spinner" />
                  <div className="video-loading-text">{streamStatus}</div>
                </div>
              )}
            </div>
            <div className="modal-body">
              <h3>{streaming.movie.title_long || streaming.movie.title}</h3>
              <div className="stream-stats">
                <span className="stream-stat-green">{streamStatus}</span>
                <span>👥 {peers} peers</span>
              </div>
              {progress > 0 && (
                <div className="stream-progress">
                  <div className="stream-progress-bar" style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <footer>
          <div className="footer-inner">
            <div className="footer-brand">ZYFLIX</div>
            <div className="footer-links">
              <a href="#">Ana Sayfa</a>
              <a href="#trending">Popüler</a>
              <a href="#latest">Yeniler</a>
              <a href="#action">Aksiyon</a>
              <a href="#comedy">Komedi</a>
            </div>
            <div className="footer-social">
              <a href="https://github.com/zysistem/zy-netflix">GitHub</a>
              <a href="https://zy-netflix.vercel.app">Vercel</a>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© {new Date().getFullYear()} ZYflix — YTS API + WebTorrent P2P</p>
            <p className="footer-disclaimer">⚠️ Bu bir demo projedir. İçerik kullanıcı sorumluluğundadır.</p>
          </div>
        </footer>
      )}
    </>
  );
}

async function createClient() {
  if (typeof window === 'undefined') return null;
  const WebTorrent = (await import('webtorrent/dist/webtorrent.min.js')).default;
  return new WebTorrent();
}
