import { Component } from "@angular/core";

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

  constructor(private searchService: SearchService) {
    // injects SearchService as this.searchService
  }

  export() {
    console.log("export() [Not imlemented yet.]");
  }

  import() {
    console.log("import() [Not imlemented yet.]");
  }

  delete() {
    this.searchService.del(""); // empty id deletes all entries
    this.confirmDelete = false;
  }
}
