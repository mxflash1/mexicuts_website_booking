// Deployment Setup Script
// This script helps set up environment variables for production deployment

const fs = require('fs');
const path = require('path');

// Configuration for different environments
const environments = {
  development: {
    configFile: 'public/firebase-config.json',
    description: 'Local development with config file'
  },
  production: {
    envVars: true,
    description: 'Production with environment variables'
  }
};

function createEnvironmentScript(config) {
  return `
// Environment-specific Firebase configuration
// This file is generated during build/deployment
window.FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};
`;
}

function setupProduction() {
  console.log('🚀 Setting up production environment...');
  
  // Read the config file
  const configPath = path.join(__dirname, 'public/firebase-config.json');
  
  if (!fs.existsSync(configPath)) {
    console.error('❌ firebase-config.json not found!');
    console.log('Please create public/firebase-config.json with your Firebase configuration.');
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Create environment script
  const envScript = createEnvironmentScript(config);
  const envScriptPath = path.join(__dirname, 'public/firebase-env.js');
  
  fs.writeFileSync(envScriptPath, envScript);
  console.log('✅ Created firebase-env.js for production');
  
  // Update HTML files to use environment script instead of config file
  updateHtmlForProduction();
  
  console.log('✅ Production setup complete!');
  console.log('📝 Remember to:');
  console.log('   1. Add firebase-env.js to your deployment');
  console.log('   2. Remove firebase-config.json from production');
  console.log('   3. Set up proper environment variables in your hosting platform');
}

function updateHtmlForProduction() {
  const htmlFiles = [
    'public/index.html',
    'public/admin_mxcts2009.html'
  ];
  
  htmlFiles.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Add environment script before firebase-config.js
      content = content.replace(
        '<script src="firebase-config.js"></script>',
        '<script src="firebase-env.js"></script>\n  <script src="firebase-config.js"></script>'
      );
      
      fs.writeFileSync(filePath, content);
      console.log(`✅ Updated ${filePath} for production`);
    }
  });
}

function setupDevelopment() {
  console.log('🔧 Setting up development environment...');
  
  const configPath = path.join(__dirname, 'public/firebase-config.json');
  const examplePath = path.join(__dirname, 'public/firebase-config.json.example');
  
  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(examplePath)) {
      console.log('📋 Please copy firebase-config.json.example to firebase-config.json');
      console.log('   and fill in your actual Firebase configuration.');
    } else {
      console.log('📋 Please create public/firebase-config.json with your Firebase configuration.');
    }
    return;
  }
  
  console.log('✅ Development environment ready!');
  console.log('📝 Using firebase-config.json for local development');
}

// Main execution
const environment = process.argv[2] || 'development';

switch (environment) {
  case 'production':
    setupProduction();
    break;
  case 'development':
    setupDevelopment();
    break;
  default:
    console.log('Usage: node deploy-setup.js [development|production]');
    console.log('');
    console.log('Environments:');
    Object.entries(environments).forEach(([env, config]) => {
      console.log(`  ${env}: ${config.description}`);
    });
}
