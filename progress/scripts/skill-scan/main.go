// Go 1.23 and later report a Windows junction as neither a folder nor a link,
// so a junction prints as "skipped".
package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	for _, folder := range os.Args[1:] {
		entries, err := os.ReadDir(folder)
		if err != nil {
			fmt.Printf("%s: %v\n", folder, err)
			continue
		}
		for _, entry := range entries {
			path := filepath.Join(folder, entry.Name())
			found := entry.IsDir()
			if entry.Type()&os.ModeSymlink != 0 {
				info, err := os.Stat(path)
				found = err == nil && info.IsDir()
			}
			if found {
				_, err := os.Stat(filepath.Join(path, "SKILL.md"))
				found = err == nil
			}
			verdict := "skipped"
			if found {
				verdict = "found"
			}
			fmt.Printf("%s %s (%v)\n", verdict, path, entry.Type())
		}
	}
}
