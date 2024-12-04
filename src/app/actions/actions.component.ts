import { Component } from "@angular/core";

import { Router } from "@angular/router";

import { SearchService } from "../search.service";

@Component({
  selector: "app-actions",
  standalone: true,
  imports: [],
  templateUrl: "./actions.component.html",
  styleUrl: "./actions.component.css",
})
export class ActionsComponent {
  confirmDelete: boolean = false;

  constructor(
    private router: Router,
    private searchService: SearchService,
  ) {
    // injects Router as this.router and SearchService as this.searchService
  }

  export() {
    this.searchService
      .dump()
      .then((json) => {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        return chrome.downloads.download({
          url: url,
          conflictAction: "uniquify",
          filename: ["shs-ext", "history"].join("_") + ".json",
          saveAs: true,
        });
      })
      .then((id) => {
        console.log("Download initiated with id:", id);

        this.router.navigate(["/"]);
      })
      .catch((err) => {
        console.error("Failed to dump history:", err);
      });
  }

  import() {
    // inject a hidden file input element into the DOM
    const fileChooser = document.createElement("input");
    fileChooser.hidden = true;
    fileChooser.type = "file";
    fileChooser.accept = "application/json";

    fileChooser.onchange = (evt) => {
      // read the file(s) selected by the user
      const file = (evt.target as HTMLInputElement).files?.[0];
      if (!file) {
        throw new Error("No file selected.");
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const json = event.target?.result as string;
        this.searchService
          .load(json)
          .then(() => {
            this.router.navigate(["/"]);
          })
          .catch((err) => {
            console.error("Failed to load history:", err);
          });
      };
      reader.onerror = (_evt) => {
        throw new Error("Failed to read file.");
      };

      reader.readAsText(file);
      fileChooser.remove(); // cleanup
    };

    // fake a click on the file input element
    fileChooser.click();
  }

  delete() {
    this.searchService.del(""); // empty id deletes all entries
    this.confirmDelete = false;
  }
}
