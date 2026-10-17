import { createRoot } from 'react-dom/client';

import './api/configureAxios';
import App from './App';
import './index.css';
import './styles/brand.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}

createRoot(rootElement).render(
  <App />,
);
