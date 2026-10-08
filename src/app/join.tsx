import { Redirect } from 'expo-router';

// Invitation links (hayati://join) land here; AuthProvider has already read the invite from the URL.
export default function Join() {
  return <Redirect href="/" />;
}
