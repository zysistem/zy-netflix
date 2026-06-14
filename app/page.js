'use client';

import { useEffect, useState, useRef, lazy, Suspense } from 'react';

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
  const videoRef = useRef(null);
  const clientRef = useRef(null);

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

  async function startStream(movie, torrent) {
    setStreamStatus('Bağlanıyor...');
    setProgress(0);
    setStreaming({ movie, torrent });
    setSelected(null);

    if (clientRef.current) { clientRef.current.destroy(); }

    const client = await createClient();
    if (!client) {
      setStreamStatus('WebRTC desteklenmiyor. Tarayıcınız P2P stream için uygun değil.');
      return;
    }
    clientRef.current = client;

    const url = magnet(torrent.hash, movie.title_long || movie.title);
    setStreamStatus('⏳ Torrent bulunuyor (peers aranıyor)...');

    client.add(url, (torrentObj) => {
      const file = torrentObj.files.find(f =>
        f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm')
      );
      const videoFile = file || torrentObj.files[0];

      if (videoFile && videoRef.current) {
        videoFile.renderTo(videoRef.current, { autoplay: true, controls: true });
        setStreamStatus('▶ Oynatılıyor...');
      }

      torrentObj.on('download', () => {
        setProgress(torrentObj.progress);
        setStreamStatus(`⬇ %${Math.round(torrentObj.progress * 100)} · ${torrentObj.numPeers} peers · ${(torrentObj.downloadSpeed / 1048576).toFixed(1)} MB/s`);
      });
    });

    client.on('error', (err) => {
      setStreamStatus('❌ Hata: ' + err.message);
    });
  }

  function closeStream() {
    if (clientRef.current) { clientRef.current.destroy(); clientRef.current = null; }
    setStreaming(null);
    setStreamStatus('');
    setProgress(0);
  }

  const rows = search
    ? [{ title: `"${search}" için sonuçlar (${searchResults?.length || 0})`, items: searchResults || [] }]
    : [
        { title: '🔥 En Çok İndirilenler', items: movies.trending },
        { title: '⭐ En Beğenilenler', items: movies.popular },
        { title: '🆕 Son Eklenenler', items: movies.latest },
        { title: '💥 Aksiyon', items: movies.action },
        { title: '😂 Komedi', items: movies.comedy },
      ];

  const heroMovie = movies.trending[0];

  return (
    <>
      <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <a href="#" className="navbar-logo">ZYFLIX</a>
        <ul className="navbar-links">
          <li><a href="#">Ana Sayfa</a></li>
          <li><a href="#trending">Popüler</a></li>
          <li><a href="#latest">Yeniler</a></li>
          <li><a href="#action">Aksiyon</a></li>
        </ul>
        <div className="navbar-right">
          <input className="navbar-search" type="text" placeholder="🔍 Film ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="navbar-avatar">Z</div>
        </div>
      </nav>

      {loading && (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', fontWeight: '900', color: '#e50914', letterSpacing: '-3px' }}>ZYFLIX</div>
            <div style={{ color: '#666', marginTop: '16px' }}>Filmler yükleniyor...</div>
          </div>
        </div>
      )}

      {!loading && !search && heroMovie && (
        <section className="hero">
          <div className="hero-bg">
            <img src={heroMovie.background_image_original || heroMovie.large_cover_image} alt={heroMovie.title} />
          </div>
          <div className="hero-overlay" />
          <div className="hero-content">
            <div className="hero-badge">🎬 Öne Çıkan</div>
            <h1 className="hero-title">{heroMovie.title_long || heroMovie.title}</h1>
            <p className="hero-desc">{heroMovie.summary || heroMovie.synopsis || `${heroMovie.title} (${heroMovie.year}) — ${heroMovie.genres?.join(', ')}`}</p>
            <div className="hero-buttons">
              <button className="hero-btn hero-btn-play" onClick={() => setSelected(heroMovie)}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                İzle
              </button>
              <button className="hero-btn hero-btn-info" onClick={() => setSelected(heroMovie)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                Detaylar
              </button>
            </div>
          </div>
        </section>
      )}

      {!loading && (
        <div className="content-section">
          {rows.map((row, idx) => row.items.length > 0 && (
            <div className="row" key={idx} id={['trending','popular','latest','action','comedy'][idx]}>
              <h2 className="row-title">{row.title}</h2>
              <div className="row-cards">
                {row.items.map(m => (
                  <div className="movie-card" key={m.id} onClick={() => setSelected(m)}>
                    <img src={m.medium_cover_image || m.small_cover_image} alt={m.title} loading="lazy" />
                    <div className="movie-card-overlay">
                      <div className="movie-card-title">{m.title_english || m.title}</div>
                      <div className="movie-card-rating">⭐ {m.rating} · {m.year}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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
              <div style={{ marginTop: '24px' }}>
                <div style={{ fontSize: '14px', color: '#888', marginBottom: '12px' }}>▶ İzleme kalitesi seç:</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {selected.torrents?.sort((a,b) => parseInt(a.quality) - parseInt(b.quality)).map((t, i) => (
                    <button key={i} className="quality-btn" onClick={() => startStream(selected, t)}>{t.quality} · {t.type} · {t.size}</button>
                  ))}
                </div>
                <p style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>💡 P2P torrent stream — WebTorrent. Seed sayısı yüksek olanlar daha hızlı açılır.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {streaming && (
        <div className="modal-overlay active" style={{ background: 'rgba(0,0,0,0.95)' }}>
          <div className="modal" style={{ maxWidth: '1000px' }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeStream}>✕</button>
            <div style={{ background: '#000', position: 'relative' }}>
              <video ref={videoRef} style={{ width: '100%', maxHeight: '70vh', display: 'block' }} controls autoPlay />
              {progress < 0.01 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', pointerEvents: 'none' }}>
                  <div className="spinner" />
                  <div style={{ color: '#fff', fontSize: '14px' }}>{streamStatus}</div>
                </div>
              )}
            </div>
            <div className="modal-body">
              <h3 style={{ marginBottom: '8px' }}>{streaming.movie.title_long || streaming.movie.title}</h3>
              <div style={{ fontSize: '14px', color: '#46d369', marginBottom: '8px' }}>{streamStatus}</div>
              {progress > 0 && (
                <div style={{ height: '4px', background: '#333', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress * 100}%`, background: '#e50914', transition: 'width 0.5s' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer>
        <p>© {new Date().getFullYear()} ZYflix — YTS API + WebTorrent</p>
        <p style={{ marginTop: '8px', opacity: '0.4', fontSize: '11px' }}>⚠️ P2P torrent stream. İçerik kullanıcı sorumluluğundadır.</p>
      </footer>

      <style jsx>{`
        .quality-btn {
          padding: 10px 18px;
          background: rgba(229,9,20,0.15);
          border: 1px solid rgba(229,9,20,0.4);
          border-radius: 4px;
          color: #fff;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s;
        }
        .quality-btn:hover { background: rgba(229,9,20,0.3); }
        .spinner {
          width: 50px; height: 50px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #e50914;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

// Client-side WebTorrent loader
async function createClient() {
  if (typeof window === 'undefined') return null;
  const WebTorrent = (await import('webtorrent/dist/webtorrent.min.js')).default;
  return new WebTorrent();
}
