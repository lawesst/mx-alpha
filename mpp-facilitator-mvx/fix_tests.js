const fs = require('fs');
for (const file of ['src/storage.service.spec.ts', 'src/verifier.service.spec.ts']) {
    let content = fs.readFileSync(file, 'utf8');
    // Find all createdAt: <number>
    content = content.replace(/createdAt: (\d+),?/g, (match, p1) => {
        return `createdAt: new Date(${p1}),`;
    });
    // Find all expiresAt: <number> or <string>
    content = content.replace(/expiresAt: ([^,]+),?/g, (match, p1) => {
        if (p1.trim() === 'null') return `expiresAt: null,`;
        if (p1.trim() === 'undefined') return `expiresAt: undefined,`;
        if (p1.includes('new Date')) return match; // already wrapped
        return `expiresAt: new Date(${p1}),`;
    });
    
    fs.writeFileSync(file, content);
}
console.log('Fixed types in tests');
