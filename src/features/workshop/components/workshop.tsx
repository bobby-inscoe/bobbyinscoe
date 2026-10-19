import {
  Anchor,
  Box,
  Title,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { useState } from 'react';
import { ProjectFolio } from '@/features/workshop/components/project-folio';
import { WorkArt } from '@/features/workshop/components/work-art';
import { WorkshopThread } from '@/features/workshop/components/workshop-thread';
import { WORKS, type Work } from '@/features/workshop/data/works';
import { useRoomMotion } from '@/features/workshop/hooks/use-room-motion';
import '@/features/workshop/components/workshop.css';

export function Workshop() {
  const [selected, setSelected] = useState<{
    work: Work;
    origin: string;
  } | null>(null);
  const [folioOpened, setFolioOpened] = useState(false);
  const [paused, setPaused] = useState(false);
  const roomRef = useRoomMotion(paused);
  function openWork(work: Work, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    setFolioOpened(true);
    setSelected({
      work,
      origin: `${((rect.left + rect.width / 2) / window.innerWidth) * 100}% ${((rect.top + rect.height / 2) / window.innerHeight) * 100}%`,
    });
  }
  return (
    <Box className={`workshop${paused ? ' is-still' : ''}`} ref={roomRef}>
      <Anchor className="skip-link" href="#work">
        Skip to the work
      </Anchor>
      <Box className="room-atmosphere" aria-hidden="true">
        <Box className="window-light" />
        <Box className="light-ray" />
        <Box className="dust dust-one" />
        <Box className="dust dust-two" />
        <Box className="dust dust-three" />
      </Box>
      <WorkshopThread roomRef={roomRef} />
      <header className="workshop-header">
        <Anchor
          href="#entrance"
          className="wordmark"
          aria-label="Bobby Inscoe, workshop entrance"
        >
          <span className="woven-mark" aria-hidden="true">
            bi
          </span>
          <span>Bobby Inscoe</span>
        </Anchor>
        <nav aria-label="Main navigation">
          <Anchor href="#work">
            Projects <span aria-hidden="true">↘</span>
          </Anchor>
        </nav>
      </header>
      <main>
        <section
          className="entrance"
          id="entrance"
          aria-labelledby="entrance-title"
        >
          <Box className="entrance-copy">
            <Title order={1} id="entrance-title">
              Projects
            </Title>
          </Box>
          <Box className="room-overview">
            <Box className="overview-planes">
              {WORKS.map((work) => (
                <UnstyledButton
                  type="button"
                  key={work.id}
                  className={`overview-plane overview-${work.id}`}
                  onClick={(event) => openWork(work, event.currentTarget)}
                  aria-label={`Open ${work.title} project details`}
                >
                  <WorkArt kind={work.id} />
                  <span className="overview-label">
                    {work.title}
                    <span>↗</span>
                  </span>
                </UnstyledButton>
              ))}
            </Box>
          </Box>
          <Box className="entrance-bottom">
            <Anchor href="#work" className="enter-link">
              Project details <span aria-hidden="true">↓</span>
            </Anchor>
          </Box>
        </section>
        <section
          className="work-collection"
          id="work"
          aria-labelledby="work-heading"
        >
          <VisuallyHidden>
            <Title order={2} id="work-heading">
              Project details
            </Title>
          </VisuallyHidden>
          {WORKS.map((work) => (
            <article
              className={`work-area area-${work.id}`}
              key={work.id}
              aria-labelledby={`${work.id}-title`}
            >
              <Box className="surface-perspective" data-surface>
                <UnstyledButton
                  type="button"
                  className={`work-surface surface-${work.id}`}
                  onClick={(event) => openWork(work, event.currentTarget)}
                  aria-label={`Open ${work.title} project details`}
                >
                  <Box className="surface-mat">
                    <WorkArt kind={work.id} />
                  </Box>
                  <span className="surface-edge">
                    <span>{work.title}</span>
                    <span>Details ↗</span>
                  </span>
                </UnstyledButton>
              </Box>
              <Box className="work-caption">
                <span className="eyebrow">{work.label}</span>
                <Title order={3} id={`${work.id}-title`}>
                  {work.title}
                </Title>
                <p>{work.description}</p>
                <UnstyledButton
                  type="button"
                  className="text-link"
                  onClick={(event) => openWork(work, event.currentTarget)}
                >
                  View project <span aria-hidden="true">↗</span>
                </UnstyledButton>
              </Box>
            </article>
          ))}
        </section>
      </main>
      <footer className="workshop-footer">
        <Anchor href="#entrance">
          Bobby Inscoe <span aria-hidden="true">↖</span>
        </Anchor>

        <UnstyledButton
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? 'Resume atmosphere' : 'Pause atmosphere'}
          <span className="motion-mark" aria-hidden="true">
            {paused ? '▷' : 'Ⅱ'}
          </span>
        </UnstyledButton>
      </footer>
      <ProjectFolio
        work={selected?.work ?? null}
        opened={folioOpened}
        origin={selected?.origin ?? 'center'}
        onClose={() => setFolioOpened(false)}
        onExited={() => setSelected(null)}
      />
    </Box>
  );
}
