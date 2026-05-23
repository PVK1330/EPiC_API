/**
 * Microsoft / Graph integration placeholders.
 * Wire OAuth + token storage here when Azure app registration is ready.
 */

const buildAuthUrl = () => {
  const clientId = process.env.MS_CLIENT_ID;
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return null;
  }
  const scope = encodeURIComponent(
    process.env.MS_SCOPES ||
      'offline_access User.Read OnlineMeetings.ReadWrite Calendars.ReadWrite',
  );
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
};

export const getMicrosoftStatus = async (req, res) => {
  try {
    // TODO: load connection state from DB for req.user.userId
    res.status(200).json({
      status: 'success',
      message: 'Microsoft integration status',
      data: {
        isConnected: false,
        microsoftEmail: null,
        isTokenExpired: false,
      },
    });
  } catch (error) {
    console.error('Microsoft status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load Microsoft status',
      data: null,
    });
  }
};

export const getMicrosoftAuthUrl = async (req, res) => {
  try {
    const authUrl = buildAuthUrl();
    res.status(200).json({
      status: 'success',
      message: authUrl
        ? 'Authorization URL generated'
        : 'Microsoft OAuth is not configured (set MS_CLIENT_ID and MS_REDIRECT_URI)',
      data: {
        authUrl,
        configured: Boolean(authUrl),
      },
    });
  } catch (error) {
    console.error('Microsoft auth URL error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to build Microsoft auth URL',
      data: null,
    });
  }
};

export const refreshMicrosoftToken = async (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Token refresh not implemented',
    data: { refreshed: false },
  });
};

export const disconnectMicrosoft = async (req, res) => {
  try {
    // TODO: clear tokens for req.user.userId
    res.status(200).json({
      status: 'success',
      message: 'Disconnected',
      data: { disconnected: true },
    });
  } catch (error) {
    console.error('Microsoft disconnect error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to disconnect',
      data: null,
    });
  }
};
