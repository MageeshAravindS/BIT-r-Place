import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GoogleOAuthProvider } from '@react-oauth/google';

// TODO: PASTE YOUR SAME GOOGLE CLIENT ID HERE
const CLIENT_ID = "338224390635-cpfurodcu459640g1s5l675bkjkho170.apps.googleusercontent.com";

ReactDOM.createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={CLIENT_ID}>
    <App />
  </GoogleOAuthProvider>,
)