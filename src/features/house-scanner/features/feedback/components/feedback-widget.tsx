import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { createHouseholdClient } from '@/features/house-scanner/api/household-client';
import { classes } from '@/features/house-scanner/theme/shellter-theme';

export function FeedbackWidget() {
  const intl = useIntl();
  const t = (
    key: keyof typeof import('@/features/house-scanner/i18n/en').en.feedback,
  ) => intl.formatMessage({ id: `feedback.${key}` });
  const mobile = useMediaQuery('(max-width: 36em)');
  const [opened, setOpened] = useState(false);
  const [type, setType] = useState('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'success' | 'error' | 'invalid' | null>(
    null,
  );
  const [submission, setSubmission] = useState<{
    payload: string;
    id: string;
    submittedAt: string;
  } | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function send() {
    if (busy) return;
    if (
      !title.trim() ||
      !description.trim() ||
      (file &&
        (file.size > 5 * 1024 * 1024 ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)))
    ) {
      setStatus('invalid');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const client = createHouseholdClient();
      if (!client) throw new Error();
      let image: { content: string; type: string } | undefined;
      if (file) {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        image = { content, type: file.type };
      }
      const payload = JSON.stringify({
        type,
        title: title.trim(),
        description: description.trim(),
        page: `${location.origin}${location.pathname}`,
        ...(image ? { image } : {}),
      });
      const next =
        submission?.payload === payload
          ? submission
          : {
              payload,
              id: crypto.randomUUID(),
              submittedAt: new Date().toISOString(),
            };
      setSubmission(next);
      const { data, error } = await client.functions.invoke(
        'house-scanner-feedback',
        {
          body: {
            ...JSON.parse(payload),
            id: next.id,
            submittedAt: next.submittedAt,
          },
        },
      );
      if (error || data?.status !== 'sent') throw new Error();
      setTitle('');
      setDescription('');
      setFile(null);
      setSubmission(null);
      setStatus('success');
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Tooltip label={t('hint')}>
        <Button
          className={classes.feedbackLauncher}
          leftSection={<MessageCircle size={18} aria-hidden />}
          onClick={() => setOpened(true)}
        >
          {t('label')}
        </Button>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title={t('label')}
        fullScreen={mobile}
        closeButtonProps={{ 'aria-label': t('cancel') }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Stack>
            <Text size="sm">{t('intro')}</Text>
            <Select
              label={t('type')}
              value={type}
              allowDeselect={false}
              disabled={busy}
              data={[
                { value: 'bug', label: t('bug') },
                { value: 'feature', label: t('feature') },
              ]}
              onChange={(value) => {
                setType(value ?? 'bug');
                setFile(null);
                setStatus(null);
              }}
            />
            <TextInput
              required
              label={t('title')}
              maxLength={120}
              value={title}
              disabled={busy}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setStatus(null);
              }}
            />
            <Textarea
              required
              label={t('description')}
              description={t(type === 'bug' ? 'bugHelp' : 'featureHelp')}
              placeholder={t(type === 'bug' ? 'bugHelp' : 'featureHelp')}
              minRows={5}
              maxLength={5000}
              value={description}
              disabled={busy}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setStatus(null);
              }}
            />
            {type === 'bug' && (
              <>
                <FileInput
                  label={t('screenshot')}
                  description={t('imageHelp')}
                  accept="image/png,image/jpeg,image/webp"
                  clearable
                  value={file}
                  disabled={busy}
                  onChange={(value) => {
                    setFile(value);
                    setStatus(null);
                  }}
                />
                {preview && (
                  <>
                    <img
                      src={preview}
                      alt={t('screenshot')}
                      style={{
                        maxWidth: '100%',
                        maxHeight: 200,
                        objectFit: 'contain',
                      }}
                    />
                    <Button
                      variant="subtle"
                      disabled={busy}
                      onClick={() => setFile(null)}
                    >
                      {t('remove')}
                    </Button>
                  </>
                )}
              </>
            )}
            <Text size="xs" c="dimmed">
              {t('privacy')}
            </Text>
            {status && (
              <Alert
                role={status === 'success' ? 'status' : 'alert'}
                color={status === 'success' ? 'green' : 'red'}
              >
                {t(status)}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={busy}
                onClick={() => setOpened(false)}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" loading={busy}>
                {t('send')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
