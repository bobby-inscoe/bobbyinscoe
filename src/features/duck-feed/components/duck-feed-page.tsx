import { Anchor, Box } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { DuckFeed } from '@/features/duck-feed/components/duck-feed';

export function DuckFeedPage() {
  return (
    <Box component="main" className="game-room">
      <Anchor component={Link} to="/" c="inherit" className="game-return">
        ← Back to the workshop
      </Anchor>
      <DuckFeed />
    </Box>
  );
}
