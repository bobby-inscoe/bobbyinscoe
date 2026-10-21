import { ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import './back-to-top.css';

const MIN_SCROLL = 300;
const UP_DISTANCE = 24;

/** Phone-only button that appears after scrolling up a little, and hides on the way down. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    let up = 0;
    const onScroll = () => {
      const y = window.scrollY;
      up = y < last ? up + (last - y) : 0;
      last = y;
      setVisible(y > MIN_SCROLL && up >= UP_DISTANCE);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      className="back-to-top"
      data-visible={visible}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0 })}
    >
      <ArrowUp size={20} aria-hidden="true" />
    </button>
  );
}
