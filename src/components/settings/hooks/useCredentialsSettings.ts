import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type {
  ApiKeyItem,
  ApiKeysResponse,
  CreatedApiKey,
  GithubCredentialItem,
  GithubCredentialsResponse,
} from '../view/tabs/api-settings/types';
import { copyTextToClipboard } from '../../../utils/clipboard';

type UseCredentialsSettingsArgs = {
  confirmDeleteApiKeyText: string;
  confirmDeleteGithubCredentialText: string;
};

const getApiError = (payload: { error?: string } | undefined, fallback: string) => (
  payload?.error || fallback
);

/**
 * Surface a caught error to the user (alert) AND keep it in the console for
 * debugging. Centralised so every credential mutation reports failures
 * consistently instead of silently `console.error`-ing.
 */
const reportError = (prefix: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(prefix, error);
  alert(message);
};

export function useCredentialsSettings({
  confirmDeleteApiKeyText,
  confirmDeleteGithubCredentialText,
}: UseCredentialsSettingsArgs) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [githubCredentials, setGithubCredentials] = useState<GithubCredentialItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  const [showNewGithubForm, setShowNewGithubForm] = useState(false);
  const [newGithubName, setNewGithubName] = useState('');
  const [newGithubToken, setNewGithubToken] = useState('');
  const [newGithubDescription, setNewGithubDescription] = useState('');

  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedApiKey | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const [apiKeysResponse, credentialsResponse] = await Promise.all([
        authenticatedFetch('/api/settings/api-keys'),
        authenticatedFetch('/api/settings/credentials?type=github_token'),
      ]);

      const [apiKeysPayload, credentialsPayload] = await Promise.all([
        apiKeysResponse.json() as Promise<ApiKeysResponse>,
        credentialsResponse.json() as Promise<GithubCredentialsResponse>,
      ]);

      setApiKeys(apiKeysPayload.apiKeys || []);
      setGithubCredentials(credentialsPayload.credentials || []);
    } catch (error) {
      reportError('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createApiKey = useCallback(async () => {
    if (!newKeyName.trim()) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/settings/api-keys', {
        method: 'POST',
        body: JSON.stringify({ keyName: newKeyName.trim() }),
      });

      const payload = await response.json() as ApiKeysResponse;
      if (!response.ok || !payload.success) {
        const msg = getApiError(payload, 'Failed to create API key');
        console.error('Error creating API key:', msg);
        alert(msg);
        return;
      }

      if (payload.apiKey) {
        setNewlyCreatedKey(payload.apiKey);
      }
      setNewKeyName('');
      setShowNewKeyForm(false);
      await fetchData();
    } catch (error) {
      reportError('Error creating API key:', error);
    }
  }, [fetchData, newKeyName]);

  const deleteApiKey = useCallback(async (keyId: string) => {
    if (!window.confirm(confirmDeleteApiKeyText)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/settings/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json() as ApiKeysResponse;
        const msg = getApiError(payload, 'Failed to delete API key');
        console.error('Error deleting API key:', msg);
        alert(msg);
        return;
      }

      await fetchData();
    } catch (error) {
      reportError('Error deleting API key:', error);
    }
  }, [confirmDeleteApiKeyText, fetchData]);

  const toggleApiKey = useCallback(async (keyId: string, isActive: boolean) => {
    try {
      const response = await authenticatedFetch(`/api/settings/api-keys/${keyId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (!response.ok) {
        const payload = await response.json() as ApiKeysResponse;
        const msg = getApiError(payload, 'Failed to toggle API key');
        console.error('Error toggling API key:', msg);
        alert(msg);
        return;
      }

      await fetchData();
    } catch (error) {
      reportError('Error toggling API key:', error);
    }
  }, [fetchData]);

  const createGithubCredential = useCallback(async () => {
    if (!newGithubName.trim() || !newGithubToken.trim()) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/settings/credentials', {
        method: 'POST',
        body: JSON.stringify({
          credentialName: newGithubName.trim(),
          credentialType: 'github_token',
          credentialValue: newGithubToken,
          description: newGithubDescription.trim(),
        }),
      });

      const payload = await response.json() as GithubCredentialsResponse;
      if (!response.ok || !payload.success) {
        const msg = getApiError(payload, 'Failed to create GitHub credential');
        console.error('Error creating GitHub credential:', msg);
        alert(msg);
        return;
      }

      setNewGithubName('');
      setNewGithubToken('');
      setNewGithubDescription('');
      setShowNewGithubForm(false);
      setShowToken((prev) => ({ ...prev, new: false }));
      await fetchData();
    } catch (error) {
      reportError('Error creating GitHub credential:', error);
    }
  }, [fetchData, newGithubDescription, newGithubName, newGithubToken]);

  const deleteGithubCredential = useCallback(async (credentialId: string) => {
    if (!window.confirm(confirmDeleteGithubCredentialText)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/settings/credentials/${credentialId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json() as GithubCredentialsResponse;
        const msg = getApiError(payload, 'Failed to delete GitHub credential');
        console.error('Error deleting GitHub credential:', msg);
        alert(msg);
        return;
      }

      await fetchData();
    } catch (error) {
      reportError('Error deleting GitHub credential:', error);
    }
  }, [confirmDeleteGithubCredentialText, fetchData]);

  const toggleGithubCredential = useCallback(async (credentialId: string, isActive: boolean) => {
    try {
      const response = await authenticatedFetch(`/api/settings/credentials/${credentialId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (!response.ok) {
        const payload = await response.json() as GithubCredentialsResponse;
        const msg = getApiError(payload, 'Failed to toggle GitHub credential');
        console.error('Error toggling GitHub credential:', msg);
        alert(msg);
        return;
      }

      await fetchData();
    } catch (error) {
      reportError('Error toggling GitHub credential:', error);
    }
  }, [fetchData]);

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedKey(id);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, []);

  const dismissNewlyCreatedKey = useCallback(() => {
    setNewlyCreatedKey(null);
  }, []);

  const cancelNewApiKeyForm = useCallback(() => {
    setShowNewKeyForm(false);
    setNewKeyName('');
  }, []);

  const cancelNewGithubForm = useCallback(() => {
    setShowNewGithubForm(false);
    setNewGithubName('');
    setNewGithubToken('');
    setNewGithubDescription('');
    setShowToken((prev) => ({ ...prev, new: false }));
  }, []);

  const toggleNewGithubTokenVisibility = useCallback(() => {
    setShowToken((prev) => ({ ...prev, new: !prev.new }));
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    apiKeys,
    githubCredentials,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    showNewGithubForm,
    setShowNewGithubForm,
    newGithubName,
    setNewGithubName,
    newGithubToken,
    setNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showToken,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    createGithubCredential,
    deleteGithubCredential,
    toggleGithubCredential,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
    cancelNewGithubForm,
    toggleNewGithubTokenVisibility,
  };
}
