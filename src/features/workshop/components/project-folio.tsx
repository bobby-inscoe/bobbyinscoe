import {
  Anchor,
  Box,
  Button,
  Flex,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import { WorkArt } from '@/features/workshop/components/work-art';
import type { Work } from '@/features/workshop/data/works';

function getProjectHome(work: Work) {
  if (work.id === 'duck-feed') {
    return { to: '/duck-feed', action: 'Play Duck Feed' };
  }
  if (work.id === 'house-scanner') {
    return { to: '/shellter', action: 'Open Shellter' };
  }
  return null;
}

export function ProjectFolio({
  work,
  opened,
  origin,
  onClose,
  onExited,
}: {
  work: Work | null;
  opened: boolean;
  origin: string;
  onClose: () => void;
  onExited: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const projectHome = work ? getProjectHome(work) : null;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      onExitTransitionEnd={onExited}
      centered
      size={1080}
      xOffset={12}
      yOffset={24}
      padding={0}
      radius={0}
      title="Project details"
      closeButtonProps={{ 'aria-label': 'Close project details' }}
      overlayProps={{ color: '#353c32', backgroundOpacity: 0.36, blur: 3 }}
      transitionProps={{
        duration: reducedMotion ? 0 : 220,
        transition: {
          in: { opacity: 1, transform: 'translateY(0) scale(1)' },
          out: { opacity: 0, transform: 'translateY(14px) scale(.96)' },
          common: { transformOrigin: origin },
          transitionProperty: 'transform, opacity',
        },
      }}
      classNames={{
        content: 'project-folio',
        header: 'folio-top',
        title: 'folio-heading',
        close: 'folio-close',
        body: 'folio-content',
      }}
    >
      {work && (
        <>
          <Flex
            className="folio-body"
            direction={{ base: 'column', sm: 'row' }}
            align="flex-start"
            gap={{ base: 30, sm: 40 }}
            p={{ base: 24, sm: 40 }}
          >
            {projectHome ? (
              <Anchor
                component={Link}
                to={projectHome.to}
                className="folio-preview-link"
                onClick={onClose}
                aria-label={`Open ${work.title}`}
                w={{ base: '100%', sm: '46%' }}
                style={{ flexShrink: 0 }}
              >
                <Paper className="folio-preview" radius={0} p={13} w="100%">
                  <WorkArt kind={work.id} />
                </Paper>
              </Anchor>
            ) : (
              <Paper
                className="folio-preview"
                radius={0}
                p={13}
                w={{ base: '100%', sm: '46%' }}
                style={{ flexShrink: 0 }}
              >
                <WorkArt kind={work.id} />
              </Paper>
            )}
            <Stack className="folio-copy" gap={20} align="flex-start">
              <Text component="span" className="eyebrow">
                {work.label}
              </Text>
              <Title
                order={2}
                fz={{ base: 38, sm: 44 }}
                lh={1.08}
                style={{ letterSpacing: '-.04em' }}
              >
                {work.title}
              </Title>
              <Text
                ff="var(--mantine-font-family-headings)"
                fz={{ base: 19, sm: 20 }}
                lh={1.5}
              >
                {work.description}
              </Text>
              {work.paragraphs.map((paragraph) => (
                <Text key={paragraph} size="sm" c="dimmed" lh={1.85}>
                  {paragraph}
                </Text>
              ))}
              <SimpleGrid
                component="dl"
                cols={2}
                spacing={25}
                verticalSpacing={18}
                w="100%"
                py={20}
                className="folio-facts"
              >
                {work.facts.map(([label, value]) => (
                  <Box key={label}>
                    <Text
                      component="dt"
                      fz={9}
                      tt="uppercase"
                      c="dimmed"
                      style={{ letterSpacing: '.1em' }}
                    >
                      {label}
                    </Text>
                    <Text component="dd" size="xs" pt={5}>
                      {value}
                    </Text>
                  </Box>
                ))}
              </SimpleGrid>
              {projectHome ? (
                <Anchor
                  component={Link}
                  to={projectHome.to}
                  className="text-link"
                  onClick={onClose}
                >
                  {projectHome.action} <span aria-hidden="true">↗</span>
                </Anchor>
              ) : (
                <Text size="xs" c="dimmed">
                  No public demo yet.
                </Text>
              )}
            </Stack>
          </Flex>
          <Group
            className="folio-bottom"
            justify="space-between"
            gap={16}
            px={{ base: 20, sm: 30 }}
            py={14}
          >
            <Text size="xs">Bobby Inscoe</Text>
            <Button
              variant="subtle"
              onClick={onClose}
              rightSection={<span aria-hidden="true">↙</span>}
            >
              Back to projects
            </Button>
          </Group>
        </>
      )}
    </Modal>
  );
}
