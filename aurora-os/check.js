var fs = require('fs');
var html = fs.readFileSync('C:/Users/Abdul Kadir/codebase/aurora-os/web/index.html','utf8');
var scripts = html.match(/<script[^>]*src="[^"]*"[^>]*>/g) || [];
console.log('Script tags found:', scripts.length);
scripts.forEach(function(s){console.log(' ', s)});
var inlineScripts = html.match(/<script>[\s\S]*?<\/script>/g);
console.log('Inline scripts:', inlineScripts ? inlineScripts.length : 0);
// Check all app JS files
var files = ['terminal','finder','calculator','taskmanager','settings','notes','about','browser','installer','appstore'];
files.forEach(function(f) {
  try {
    new Function(fs.readFileSync('C:/Users/Abdul Kadir/codebase/aurora-os/web/apps/' + f + '.js','utf8'));
    console.log(f + '.js: OK');
  } catch(e) {
    console.log(f + '.js ERROR:', e.message);
  }
});
