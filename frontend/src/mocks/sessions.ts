import type {
  ArchEdge,
  HldContainer,
  InferredEdge,
  LldFileNode,
  RenderSession,
  SessionMeta,
} from '../types/schema';
import { computeSessionStats, rollupVerifiedHldEdges } from '../lib/graph';

function buildSession(
  sessionMeta: Omit<SessionMeta, 'stats'>,
  containers: HldContainer[],
  nodes: LldFileNode[],
  lldEdges: ArchEdge[],
  inferredHldEdges: InferredEdge[] = [],
  labels?: Record<string, string>
): RenderSession {
  const verifiedHldEdges = rollupVerifiedHldEdges(nodes, lldEdges, labels);
  const edges: ArchEdge[] = [...lldEdges, ...verifiedHldEdges, ...inferredHldEdges];
  const stats = computeSessionStats(nodes, edges);
  return {
    schema_version: '0.1',
    session: {
      ...sessionMeta,
      stats,
    },
    containers,
    nodes,
    edges,
    overrides: { positions: {}, renamed: {} },
  };
}

// 1. E-Commerce App (6 containers, 14 nodes)
const ecommerceContainers: HldContainer[] = [
  { id: 'c_frontend', label: 'Storefront UI', category: 'frontend', summary: 'React customer portal' },
  { id: 'c_api', label: 'API Gateway', category: 'api', summary: 'FastAPI routing & auth' },
  { id: 'c_orders', label: 'Order Service', category: 'service', summary: 'Order checkout & state' },
  { id: 'c_inventory', label: 'Inventory Service', category: 'service', summary: 'Stock tracking' },
  { id: 'c_db', label: 'Postgres DB', category: 'data', summary: 'Transactional persistence' },
  { id: 'c_stripe', label: 'Payment Integration', category: 'external', summary: 'Stripe gateway client' },
];

const ecommerceNodes: LldFileNode[] = [
  {
    id: 'src/frontend/App.tsx',
    container_id: 'c_frontend',
    label: 'App.tsx',
    language: 'typescript',
    summary: 'Root application shell',
    line_count: 80,
    symbols: [
      { kind: 'function', name: 'App', line: 12, summary: 'Root component' },
      { kind: 'const', name: 'routes', line: 45, summary: 'Client routes' },
    ],
  },
  {
    id: 'src/frontend/Cart.tsx',
    container_id: 'c_frontend',
    label: 'Cart.tsx',
    language: 'typescript',
    summary: 'Shopping cart view',
    line_count: 65,
    symbols: [
      { kind: 'function', name: 'CartView', line: 10, summary: 'Cart render' },
      { kind: 'function', name: 'calcTotal', line: 40, summary: 'Subtotal calculation' },
    ],
  },
  {
    id: 'src/frontend/Checkout.tsx',
    container_id: 'c_frontend',
    label: 'Checkout.tsx',
    language: 'typescript',
    summary: 'Checkout payment form',
    line_count: 90,
    symbols: [
      { kind: 'function', name: 'CheckoutForm', line: 15, summary: 'Form component' },
      { kind: 'function', name: 'submitOrder', line: 55, summary: 'Order submission' },
    ],
  },
  {
    id: 'src/api/routes.py',
    container_id: 'c_api',
    label: 'routes.py',
    language: 'python',
    summary: 'REST endpoints',
    line_count: 120,
    symbols: [
      { kind: 'function', name: 'create_order_endpoint', line: 20, summary: 'POST /orders' },
      { kind: 'function', name: 'get_stock_endpoint', line: 60, summary: 'GET /stock' },
    ],
  },
  {
    id: 'src/api/middleware.py',
    container_id: 'c_api',
    label: 'middleware.py',
    language: 'python',
    summary: 'CORS & Logging middleware',
    line_count: 50,
    symbols: [
      { kind: 'class', name: 'RequestLogger', line: 10, summary: 'Logs incoming requests' },
      { kind: 'function', name: 'cors_setup', line: 30, summary: 'CORS configuration' },
    ],
  },
  {
    id: 'src/api/auth.py',
    container_id: 'c_api',
    label: 'auth.py',
    language: 'python',
    summary: 'JWT token verification',
    line_count: 70,
    symbols: [
      { kind: 'function', name: 'verify_jwt', line: 15, summary: 'Token decode & verify' },
      { kind: 'class', name: 'AuthHeader', line: 45, summary: 'Header extractor' },
    ],
  },
  {
    id: 'src/services/order_service.py',
    container_id: 'c_orders',
    label: 'order_service.py',
    language: 'python',
    summary: 'Order processing workflows',
    line_count: 110,
    symbols: [
      { kind: 'class', name: 'OrderManager', line: 18, summary: 'Workflow coordinator' },
      { kind: 'method', name: 'place_order', line: 42, summary: 'Executes order placement' },
    ],
  },
  {
    id: 'src/services/order_model.py',
    container_id: 'c_orders',
    label: 'order_model.py',
    language: 'python',
    summary: 'Order data models',
    line_count: 55,
    symbols: [
      { kind: 'class', name: 'OrderRecord', line: 10, summary: 'Order schema' },
      { kind: 'const', name: 'ORDER_STATUSES', line: 35, summary: 'Valid statuses' },
    ],
  },
  {
    id: 'src/services/inventory_service.py',
    container_id: 'c_inventory',
    label: 'inventory_service.py',
    language: 'python',
    summary: 'Stock level checks',
    line_count: 85,
    symbols: [
      { kind: 'class', name: 'InventoryTracker', line: 12, summary: 'Stock manager' },
      { kind: 'method', name: 'reserve_items', line: 38, summary: 'Reserves SKU quantity' },
    ],
  },
  {
    id: 'src/services/stock_model.py',
    container_id: 'c_inventory',
    label: 'stock_model.py',
    language: 'python',
    summary: 'Stock entity definition',
    line_count: 45,
    symbols: [
      { kind: 'class', name: 'StockItem', line: 8, summary: 'SKU model' },
      { kind: 'function', name: 'validate_sku', line: 25, summary: 'SKU regex check' },
    ],
  },
  {
    id: 'src/db/connection.py',
    container_id: 'c_db',
    label: 'connection.py',
    language: 'python',
    summary: 'SQLAlchemy pool connection',
    line_count: 75,
    symbols: [
      { kind: 'function', name: 'get_db_session', line: 20, summary: 'Yields session' },
      { kind: 'const', name: 'ENGINE', line: 40, summary: 'DB Engine instance' },
    ],
  },
  {
    id: 'src/db/migrations.py',
    container_id: 'c_db',
    label: 'migrations.py',
    language: 'python',
    summary: 'Alembic schema migrations',
    line_count: 60,
    symbols: [
      { kind: 'function', name: 'apply_migrations', line: 15, summary: 'Runs alembic upgrade' },
      { kind: 'const', name: 'REVISION', line: 35, summary: 'Target version' },
    ],
  },
  {
    id: 'src/integrations/stripe_client.py',
    container_id: 'c_stripe',
    label: 'stripe_client.py',
    language: 'python',
    summary: 'Stripe SDK wrapper',
    line_count: 95,
    symbols: [
      { kind: 'class', name: 'StripeGateway', line: 14, summary: 'Charges & refunds' },
      { kind: 'method', name: 'create_charge', line: 44, summary: 'Executes charge' },
    ],
  },
  {
    id: 'src/integrations/webhook_listener.py',
    container_id: 'c_stripe',
    label: 'webhook_listener.py',
    language: 'python',
    summary: 'Stripe webhook signature validation',
    line_count: 50,
    symbols: [
      { kind: 'function', name: 'verify_signature', line: 12, summary: 'HMAC signature check' },
      { kind: 'const', name: 'EVENT_TYPES', line: 30, summary: 'Supported webhooks' },
    ],
  },
];

const ecommerceLldEdges: ArchEdge[] = [
  // 8 Intra-container verified edges
  { id: 'ec_l1', scope: 'lld', source: 'src/frontend/Cart.tsx', target: 'src/frontend/App.tsx', label: 'renders inside', provenance: 'verified', evidence: [{ file: 'src/frontend/Cart.tsx', line: 10 }] },
  { id: 'ec_l2', scope: 'lld', source: 'src/frontend/Checkout.tsx', target: 'src/frontend/Cart.tsx', label: 'navigates from', provenance: 'verified', evidence: [{ file: 'src/frontend/Checkout.tsx', line: 15 }] },
  { id: 'ec_l3', scope: 'lld', source: 'src/api/middleware.py', target: 'src/api/auth.py', label: 'authenticates via', provenance: 'verified', evidence: [{ file: 'src/api/middleware.py', line: 10 }] },
  { id: 'ec_l4', scope: 'lld', source: 'src/api/routes.py', target: 'src/api/auth.py', label: 'depends on', provenance: 'verified', evidence: [{ file: 'src/api/routes.py', line: 20 }] },
  { id: 'ec_l5', scope: 'lld', source: 'src/services/order_service.py', target: 'src/services/order_model.py', label: 'instantiates', provenance: 'verified', evidence: [{ file: 'src/services/order_service.py', line: 18 }] },
  { id: 'ec_l6', scope: 'lld', source: 'src/services/inventory_service.py', target: 'src/services/stock_model.py', label: 'updates', provenance: 'verified', evidence: [{ file: 'src/services/inventory_service.py', line: 12 }] },
  { id: 'ec_l7', scope: 'lld', source: 'src/db/migrations.py', target: 'src/db/connection.py', label: 'executes through', provenance: 'verified', evidence: [{ file: 'src/db/migrations.py', line: 15 }] },
  { id: 'ec_l8', scope: 'lld', source: 'src/integrations/webhook_listener.py', target: 'src/integrations/stripe_client.py', label: 'uses client', provenance: 'verified', evidence: [{ file: 'src/integrations/webhook_listener.py', line: 12 }] },
  // 10 Cross-container verified edges
  { id: 'ec_l9', scope: 'lld', source: 'src/frontend/Checkout.tsx', target: 'src/api/routes.py', label: 'calls POST /orders', provenance: 'verified', evidence: [{ file: 'src/frontend/Checkout.tsx', line: 55 }] },
  { id: 'ec_l10', scope: 'lld', source: 'src/frontend/Cart.tsx', target: 'src/api/routes.py', label: 'fetches /stock', provenance: 'verified', evidence: [{ file: 'src/frontend/Cart.tsx', line: 40 }] },
  { id: 'ec_l11', scope: 'lld', source: 'src/frontend/App.tsx', target: 'src/api/middleware.py', label: 'health check', provenance: 'verified', evidence: [{ file: 'src/frontend/App.tsx', line: 12 }] },
  { id: 'ec_l12', scope: 'lld', source: 'src/api/routes.py', target: 'src/services/order_service.py', label: 'invokes place_order', provenance: 'verified', evidence: [{ file: 'src/api/routes.py', line: 20 }] },
  { id: 'ec_l13', scope: 'lld', source: 'src/api/routes.py', target: 'src/services/inventory_service.py', label: 'invokes reserve_items', provenance: 'verified', evidence: [{ file: 'src/api/routes.py', line: 60 }] },
  { id: 'ec_l14', scope: 'lld', source: 'src/services/order_service.py', target: 'src/services/inventory_service.py', label: 'checks availability', provenance: 'verified', evidence: [{ file: 'src/services/order_service.py', line: 42 }] },
  { id: 'ec_l15', scope: 'lld', source: 'src/services/order_service.py', target: 'src/db/connection.py', label: 'persists order', provenance: 'verified', evidence: [{ file: 'src/services/order_service.py', line: 42 }] },
  { id: 'ec_l16', scope: 'lld', source: 'src/services/inventory_service.py', target: 'src/db/connection.py', label: 'updates stock row', provenance: 'verified', evidence: [{ file: 'src/services/inventory_service.py', line: 38 }] },
  { id: 'ec_l17', scope: 'lld', source: 'src/services/order_service.py', target: 'src/integrations/stripe_client.py', label: 'authorizes card', provenance: 'verified', evidence: [{ file: 'src/services/order_service.py', line: 42 }] },
  { id: 'ec_l18', scope: 'lld', source: 'src/api/routes.py', target: 'src/db/connection.py', label: 'session dependency', provenance: 'verified', evidence: [{ file: 'src/api/routes.py', line: 20 }] },
  // 1 Inferred LLD edge
  { id: 'ec_inf_l1', scope: 'lld', source: 'src/frontend/Checkout.tsx', target: 'src/integrations/stripe_client.py', label: 'tokenizes card', provenance: 'inferred', reason: 'Client-side Stripe Elements SDK dynamically tokenizes payment' },
];

const ecommerceInferredHldEdges: InferredEdge[] = [
  { id: 'hld:c_stripe->c_api', scope: 'hld', source: 'c_stripe', target: 'c_api', label: 'webhook push', provenance: 'inferred', reason: 'Stripe webhook HTTP call into the API' },
  { id: 'hld:c_db->c_orders', scope: 'hld', source: 'c_db', target: 'c_orders', label: 'db change notification', provenance: 'inferred', reason: 'SQL queries through a DB driver and row change listeners' },
];

const ecommerceLabels = {
  'c_frontend->c_api': 'REST API traffic',
  'c_api->c_orders': 'dispatches orders',
  'c_api->c_inventory': 'queries stock',
  'c_orders->c_inventory': 'reserves stock',
  'c_orders->c_db': 'writes transactions',
  'c_inventory->c_db': 'stock updates',
  'c_orders->c_stripe': 'processes payments',
  'c_api->c_db': 'database sessions',
};

// 2. AI Assistant (5 containers, 10 nodes)
const aiContainers: HldContainer[] = [
  { id: 'c_web', label: 'Chat Web App', category: 'frontend', summary: 'Next.js assistant interface' },
  { id: 'c_gateway', label: 'Gateway API', category: 'api', summary: 'FastAPI websocket & rate limit' },
  { id: 'c_llm_core', label: 'LLM Orchestrator', category: 'service', summary: 'Agent prompt generation & RAG' },
  { id: 'c_vector_store', label: 'Vector Store', category: 'data', summary: 'ChromaDB embeddings index' },
  { id: 'c_providers', label: 'External Models', category: 'external', summary: 'OpenAI & Anthropic connectors' },
];

const aiNodes: LldFileNode[] = [
  { id: 'src/web/ChatView.tsx', container_id: 'c_web', label: 'ChatView.tsx', language: 'typescript', summary: 'Message list & input', line_count: 85, symbols: [{ kind: 'function', name: 'ChatView', line: 10, summary: 'Main chat' }, { kind: 'const', name: 'useChat', line: 30, summary: 'Hook' }] },
  { id: 'src/web/SettingsModal.tsx', container_id: 'c_web', label: 'SettingsModal.tsx', language: 'typescript', summary: 'Model config dialog', line_count: 55, symbols: [{ kind: 'function', name: 'SettingsModal', line: 12, summary: 'Dialog' }, { kind: 'const', name: 'MODELS', line: 35, summary: 'Defaults' }] },
  { id: 'src/gateway/server.py', container_id: 'c_gateway', label: 'server.py', language: 'python', summary: 'FastAPI gateway app', line_count: 100, symbols: [{ kind: 'function', name: 'stream_chat', line: 20, summary: 'Streaming endpoint' }, { kind: 'class', name: 'AppConfig', line: 60, summary: 'Server settings' }] },
  { id: 'src/gateway/rate_limiter.py', container_id: 'c_gateway', label: 'rate_limiter.py', language: 'python', summary: 'Token bucket limiter', line_count: 45, symbols: [{ kind: 'class', name: 'TokenBucket', line: 10, summary: 'Bucket limiter' }, { kind: 'method', name: 'consume', line: 25, summary: 'Consumes token' }] },
  { id: 'src/llm/orchestrator.py', container_id: 'c_llm_core', label: 'orchestrator.py', language: 'python', summary: 'Context & prompt routing', line_count: 130, symbols: [{ kind: 'class', name: 'AgentPipeline', line: 15, summary: 'Pipeline' }, { kind: 'method', name: 'run_step', line: 50, summary: 'Runs step' }] },
  { id: 'src/llm/prompt_builder.py', container_id: 'c_llm_core', label: 'prompt_builder.py', language: 'python', summary: 'Jinja templates for LLM', line_count: 60, symbols: [{ kind: 'function', name: 'render_system', line: 14, summary: 'Builds system prompt' }, { kind: 'const', name: 'TEMPLATES', line: 35, summary: 'Template map' }] },
  { id: 'src/data/chroma_client.py', container_id: 'c_vector_store', label: 'chroma_client.py', language: 'python', summary: 'Vector index queries', line_count: 75, symbols: [{ kind: 'class', name: 'VectorStore', line: 12, summary: 'Store' }, { kind: 'method', name: 'query_similar', line: 36, summary: 'Queries vectors' }] },
  { id: 'src/data/embeddings.py', container_id: 'c_vector_store', label: 'embeddings.py', language: 'python', summary: 'Embedding dimension cache', line_count: 50, symbols: [{ kind: 'function', name: 'compute_hash', line: 15, summary: 'Hash embedding' }, { kind: 'const', name: 'DIMENSION', line: 30, summary: 'Vector dims' }] },
  { id: 'src/ext/openai_client.py', container_id: 'c_providers', label: 'openai_client.py', language: 'python', summary: 'OpenAI API client', line_count: 90, symbols: [{ kind: 'class', name: 'OpenAIClient', line: 16, summary: 'Chat completions' }, { kind: 'method', name: 'stream_completion', line: 42, summary: 'SSE client' }] },
  { id: 'src/ext/anthropic_client.py', container_id: 'c_providers', label: 'anthropic_client.py', language: 'python', summary: 'Anthropic Claude client', line_count: 80, symbols: [{ kind: 'class', name: 'AnthropicClient', line: 15, summary: 'Messages API' }, { kind: 'method', name: 'create_message', line: 40, summary: 'Sends message' }] },
];

const aiLldEdges: ArchEdge[] = [
  { id: 'ai_l1', scope: 'lld', source: 'src/web/SettingsModal.tsx', target: 'src/web/ChatView.tsx', label: 'opens from', provenance: 'verified', evidence: [{ file: 'src/web/SettingsModal.tsx', line: 12 }] },
  { id: 'ai_l2', scope: 'lld', source: 'src/gateway/server.py', target: 'src/gateway/rate_limiter.py', label: 'checks limits', provenance: 'verified', evidence: [{ file: 'src/gateway/server.py', line: 20 }] },
  { id: 'ai_l3', scope: 'lld', source: 'src/llm/orchestrator.py', target: 'src/llm/prompt_builder.py', label: 'formats prompt', provenance: 'verified', evidence: [{ file: 'src/llm/orchestrator.py', line: 15 }] },
  { id: 'ai_l4', scope: 'lld', source: 'src/data/chroma_client.py', target: 'src/data/embeddings.py', label: 'dimensions', provenance: 'verified', evidence: [{ file: 'src/data/chroma_client.py', line: 12 }] },
  { id: 'ai_l5', scope: 'lld', source: 'src/web/ChatView.tsx', target: 'src/gateway/server.py', label: 'WebSocket /chat', provenance: 'verified', evidence: [{ file: 'src/web/ChatView.tsx', line: 30 }] },
  { id: 'ai_l6', scope: 'lld', source: 'src/gateway/server.py', target: 'src/llm/orchestrator.py', label: 'dispatches prompt', provenance: 'verified', evidence: [{ file: 'src/gateway/server.py', line: 20 }] },
  { id: 'ai_l7', scope: 'lld', source: 'src/llm/orchestrator.py', target: 'src/data/chroma_client.py', label: 'retrieves context', provenance: 'verified', evidence: [{ file: 'src/llm/orchestrator.py', line: 50 }] },
  { id: 'ai_l8', scope: 'lld', source: 'src/llm/orchestrator.py', target: 'src/ext/openai_client.py', label: 'calls gpt-4o', provenance: 'verified', evidence: [{ file: 'src/llm/orchestrator.py', line: 50 }] },
  { id: 'ai_l9', scope: 'lld', source: 'src/llm/orchestrator.py', target: 'src/ext/anthropic_client.py', label: 'calls claude-3', provenance: 'verified', evidence: [{ file: 'src/llm/orchestrator.py', line: 50 }] },
  { id: 'ai_l10', scope: 'lld', source: 'src/data/embeddings.py', target: 'src/ext/openai_client.py', label: 'text-embedding-3', provenance: 'verified', evidence: [{ file: 'src/data/embeddings.py', line: 15 }] },
];

const aiInferredHldEdges: InferredEdge[] = [
  { id: 'hld:c_providers->c_gateway', scope: 'hld', source: 'c_providers', target: 'c_gateway', label: 'SSE streaming push', provenance: 'inferred', reason: 'Server-sent events streamed back via long-lived connection' },
];

// 3. Portfolio Website (4 containers, 8 nodes)
const portfolioContainers: HldContainer[] = [
  { id: 'c_ui', label: 'Site UI', category: 'frontend', summary: 'Static pages & components' },
  { id: 'c_api_pf', label: 'Server Functions', category: 'api', summary: 'Serverless form handlers' },
  { id: 'c_content_pf', label: 'Content Engine', category: 'service', summary: 'Markdown & blog parser' },
  { id: 'c_assets_pf', label: 'Media Assets', category: 'data', summary: 'Static images & meta' },
];

const portfolioNodes: LldFileNode[] = [
  { id: 'src/ui/Header.tsx', container_id: 'c_ui', label: 'Header.tsx', language: 'typescript', summary: 'Navigation header', line_count: 50, symbols: [{ kind: 'function', name: 'Header', line: 10, summary: 'Nav' }, { kind: 'const', name: 'NAV_LINKS', line: 30, summary: 'Links' }] },
  { id: 'src/ui/ProjectGrid.tsx', container_id: 'c_ui', label: 'ProjectGrid.tsx', language: 'typescript', summary: 'Portfolio showcase grid', line_count: 70, symbols: [{ kind: 'function', name: 'ProjectGrid', line: 12, summary: 'Grid' }, { kind: 'const', name: 'ProjectCard', line: 40, summary: 'Card' }] },
  { id: 'src/api/projects.ts', container_id: 'c_api_pf', label: 'projects.ts', language: 'typescript', summary: 'Project listing route', line_count: 45, symbols: [{ kind: 'function', name: 'getProjects', line: 10, summary: 'Handler' }, { kind: 'const', name: 'CACHE_TTL', line: 25, summary: 'TTL' }] },
  { id: 'src/api/contact.ts', container_id: 'c_api_pf', label: 'contact.ts', language: 'typescript', summary: 'Contact message submission', line_count: 55, symbols: [{ kind: 'function', name: 'postContact', line: 14, summary: 'Handler' }, { kind: 'function', name: 'validateEmail', line: 35, summary: 'Regex check' }] },
  { id: 'src/content/parser.ts', container_id: 'c_content_pf', label: 'parser.ts', language: 'typescript', summary: 'Frontmatter extractor', line_count: 65, symbols: [{ kind: 'function', name: 'parseMarkdown', line: 12, summary: 'Parse MD' }, { kind: 'class', name: 'Frontmatter', line: 35, summary: 'Schema' }] },
  { id: 'src/content/markdown.ts', container_id: 'c_content_pf', label: 'markdown.ts', language: 'typescript', summary: 'Markdown to HTML renderer', line_count: 60, symbols: [{ kind: 'function', name: 'renderHtml', line: 15, summary: 'Render' }, { kind: 'const', name: 'PLUGINS', line: 40, summary: 'Remark plugins' }] },
  { id: 'src/assets/images.ts', container_id: 'c_assets_pf', label: 'images.ts', language: 'typescript', summary: 'Optimized image registry', line_count: 40, symbols: [{ kind: 'const', name: 'HERO_IMG', line: 10, summary: 'Hero asset' }, { kind: 'function', name: 'getSrcSet', line: 25, summary: 'SrcSet builder' }] },
  { id: 'src/assets/metadata.json.ts', container_id: 'c_assets_pf', label: 'metadata.json.ts', language: 'typescript', summary: 'SEO manifest data', line_count: 35, symbols: [{ kind: 'const', name: 'SITE_META', line: 8, summary: 'Meta tags' }, { kind: 'function', name: 'getOgTag', line: 20, summary: 'OG tags' }] },
];

const portfolioLldEdges: ArchEdge[] = [
  { id: 'pf_l1', scope: 'lld', source: 'src/ui/ProjectGrid.tsx', target: 'src/ui/Header.tsx', label: 'references nav', provenance: 'verified', evidence: [{ file: 'src/ui/ProjectGrid.tsx', line: 12 }] },
  { id: 'pf_l2', scope: 'lld', source: 'src/content/parser.ts', target: 'src/content/markdown.ts', label: 'pipes to', provenance: 'verified', evidence: [{ file: 'src/content/parser.ts', line: 12 }] },
  { id: 'pf_l3', scope: 'lld', source: 'src/ui/ProjectGrid.tsx', target: 'src/api/projects.ts', label: 'fetches list', provenance: 'verified', evidence: [{ file: 'src/ui/ProjectGrid.tsx', line: 12 }] },
  { id: 'pf_l4', scope: 'lld', source: 'src/ui/Header.tsx', target: 'src/api/contact.ts', label: 'submits form', provenance: 'verified', evidence: [{ file: 'src/ui/Header.tsx', line: 10 }] },
  { id: 'pf_l5', scope: 'lld', source: 'src/api/projects.ts', target: 'src/content/parser.ts', label: 'loads posts', provenance: 'verified', evidence: [{ file: 'src/api/projects.ts', line: 10 }] },
  { id: 'pf_l6', scope: 'lld', source: 'src/api/contact.ts', target: 'src/content/parser.ts', label: 'validates schema', provenance: 'verified', evidence: [{ file: 'src/api/contact.ts', line: 14 }] },
  { id: 'pf_l7', scope: 'lld', source: 'src/content/parser.ts', target: 'src/assets/metadata.json.ts', label: 'enriches meta', provenance: 'verified', evidence: [{ file: 'src/content/parser.ts', line: 35 }] },
  { id: 'pf_l8', scope: 'lld', source: 'src/content/markdown.ts', target: 'src/assets/images.ts', label: 'resolves URLs', provenance: 'verified', evidence: [{ file: 'src/content/markdown.ts', line: 15 }] },
];

// 4. Dense Monorepo (Stress Test) Deterministic generator (<= 55 lines)
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateStressSession(): {
  containers: HldContainer[]; nodes: LldFileNode[]; lldEdges: ArchEdge[]; inferredHldEdges: InferredEdge[];
} {
  const R = mulberry32(42), layers = [2, 3, 4, 2, 1], cats: HldContainer['category'][] = ['frontend', 'api', 'service', 'data', 'external'];
  const cLayers: number[] = [], containers: HldContainer[] = [];
  layers.forEach((sz, l) => { for (let s = 0; s < sz; s++) cLayers.push(l); });
  for (let c = 0; c < 12; c++) containers.push({ id: `c_${c}`, label: `Package ${c}`, category: cats[cLayers[c]], summary: `Monorepo package ${c}` });
  const nodes: LldFileNode[] = [], cNodes: LldFileNode[][] = Array.from({ length: 12 }, () => []);
  for (let c = 0; c < 12; c++) {
    for (let i = 0; i < (c < 8 ? 7 : 6); i++) {
      const id = `pkg_${c}/file_${i}.ts`;
      const n: LldFileNode = { id, container_id: `c_${c}`, label: `file_${i}.ts`, language: 'typescript', summary: `Module file ${i} in pkg ${c}`, line_count: 100, symbols: [{ kind: 'function', name: `fn_${i}`, line: 10, summary: 'Exported handler' }, { kind: 'const', name: `CONFIG_${i}`, line: 20, summary: 'Configuration' }] };
      nodes.push(n); cNodes[c].push(n);
    }
  }
  const lldEdges: ArchEdge[] = [], edgePairs = new Set<string>();
  const addLld = (src: string, tgt: string) => {
    if (src === tgt || edgePairs.has(`${src}->${tgt}`)) return false;
    edgePairs.add(`${src}->${tgt}`);
    lldEdges.push({ id: `e_stress_${lldEdges.length}`, scope: 'lld', source: src, target: tgt, label: 'imports', provenance: 'verified', evidence: [{ file: src, line: 1 + Math.floor(R() * 25) }] });
    return true;
  };
  addLld(cNodes[5][0].id, cNodes[2][0].id); addLld(cNodes[7][0].id, cNodes[4][0].id); addLld(cNodes[9][0].id, cNodes[6][0].id); // 3 back edges
  addLld(cNodes[2][0].id, cNodes[5][0].id); addLld(cNodes[4][0].id, cNodes[7][0].id); addLld(cNodes[6][0].id, cNodes[9][0].id); // forward counterparts
  for (let c = 0; c < 12; c++) addLld(cNodes[c][0].id, cNodes[c][1].id); // 12 intra edges
  for (let c = 0; c < 3; c++) addLld(cNodes[c][1].id, cNodes[c][2].id);  // +3 intra edges (~10% total)
  while (lldEdges.length < 150) {
    const src = nodes[Math.floor(R() * 80)], sL = cLayers[+src.container_id.slice(2)];
    const cands = nodes.filter(n => n.id !== src.id && (cLayers[+n.container_id.slice(2)] === sL || cLayers[+n.container_id.slice(2)] === sL + 1));
    if (cands.length) addLld(src.id, cands[Math.floor(R() * cands.length)].id);
  }
  const infLld: ArchEdge[] = [];
  while (infLld.length < 3) {
    const s = nodes[Math.floor(R() * 80)].id, t = nodes[Math.floor(R() * 80)].id;
    if (s !== t && !edgePairs.has(`${s}->${t}`)) {
      edgePairs.add(`${s}->${t}`);
      infLld.push({ id: `e_stress_inf_${infLld.length}`, scope: 'lld', source: s, target: t, label: 'dynamic dispatch', provenance: 'inferred', reason: 'Plugin event hook dispatch' });
    }
  }
  const verifiedHldPairs = new Set<string>();
  for (const e of lldEdges) {
    const sC = `c_${e.source.split('/')[0].slice(4)}`, tC = `c_${e.target.split('/')[0].slice(4)}`;
    if (sC !== tC) verifiedHldPairs.add(`${sC}->${tC}`);
  }
  const candidateHld: [string, string][] = [['c_11', 'c_0'], ['c_10', 'c_1'], ['c_8', 'c_0'], ['c_9', 'c_3']];
  const inferredHldEdges: InferredEdge[] = candidateHld.filter(([s, t]) => !verifiedHldPairs.has(`${s}->${t}`)).map(([s, t]) => ({
    id: `hld:${s}->${t}`, scope: 'hld', source: s, target: t, label: 'pub/sub broadcast', provenance: 'inferred', reason: 'Asynchronous event bus broadcast',
  }));
  return { containers, nodes, lldEdges: [...lldEdges, ...infLld], inferredHldEdges };
}

const stressData = generateStressSession();

export const MOCK_SESSIONS: RenderSession[] = [
  buildSession(
    {
      id: 'sess_ecommerce',
      name: 'E-Commerce App',
      source_type: 'local',
      source_ref: 'C:/Projects/ecommerce-app',
      commit_sha: 'a1b2c3d',
      dirty: true,
      is_demo: true,
      created_at: '2026-01-15T10:00:00.000Z',
    },
    ecommerceContainers,
    ecommerceNodes,
    ecommerceLldEdges,
    ecommerceInferredHldEdges,
    ecommerceLabels
  ),
  buildSession(
    {
      id: 'sess_ai_assistant',
      name: 'AI Assistant',
      source_type: 'github',
      source_ref: 'https://github.com/example/ai-assistant',
      commit_sha: 'b2c3d4e',
      dirty: false,
      is_demo: true,
      created_at: '2026-01-16T12:00:00.000Z',
    },
    aiContainers,
    aiNodes,
    aiLldEdges,
    aiInferredHldEdges
  ),
  buildSession(
    {
      id: 'sess_portfolio',
      name: 'Portfolio Website',
      source_type: 'local',
      source_ref: 'C:\\Users\\dev\\Projects\\portfolio',
      commit_sha: 'c3d4e5f',
      dirty: true,
      is_demo: true,
      created_at: '2026-01-17T14:00:00.000Z',
    },
    portfolioContainers,
    portfolioNodes,
    portfolioLldEdges
  ),
  buildSession(
    {
      id: 'sess_stress_dense',
      name: 'Dense Monorepo (Stress Test)',
      source_type: 'local',
      source_ref: 'C:/Repos/dense-monorepo',
      commit_sha: 'd4e5f6a',
      dirty: true,
      is_demo: true,
      created_at: '2026-01-18T16:00:00.000Z',
    },
    stressData.containers,
    stressData.nodes,
    stressData.lldEdges,
    stressData.inferredHldEdges
  ),
];
